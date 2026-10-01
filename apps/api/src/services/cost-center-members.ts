import { and, costCenterMembers, costCenters, eq, inArray, jobState, user } from '@api-selfservice/db';
import { formatCostCenter, type CostCenterMemberRole } from '@api-selfservice/shared';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, notFound } from '../errors.js';
import { audit } from './audit.js';
import { notify, notifyUser } from './notifications.js';
import { getCostCenter, getDefaultCostCenter, syncTeamMembership } from './cost-centers.js';
import { blockKeysOfMember, unblockKeysOfMember } from './keys.js';

// ---------- Cost center members = LiteLLM team members (F-KST-10 to F-KST-13) ----------

type CC = typeof costCenters.$inferSelect;
type Member = typeof costCenterMembers.$inferSelect;
type UserRow = typeof user.$inferSelect;

/** Keys of a removed member still hang on the team, so they stay blocked until the person is added again. */
const REMOVED_REASON = 'cost_center_member_removed';

export async function getMembership(deps: Pick<Deps, 'db'>, userId: string, costCenterId: string): Promise<Member | null> {
  const m = await deps.db.query.costCenterMembers.findFirst({
    where: and(eq(costCenterMembers.userId, userId), eq(costCenterMembers.costCenterId, costCenterId)),
  });
  return m ?? null;
}

/** Whether the user may book keys on the cost center: everyone on the default, otherwise members only (F-KST-12). */
export async function isMember(deps: Pick<Deps, 'db'>, userId: string, cc: CC) {
  return cc.isDefault || (await getMembership(deps, userId, cc.id)) !== null;
}

/** Approved cost centers the user may create keys on: the default first, then every membership. */
export async function memberCostCenters(deps: Deps, userId: string) {
  const def = await getDefaultCostCenter(deps);
  const rows = await deps.db
    .select({ id: costCenters.id, number: costCenters.number, name: costCenters.name, role: costCenterMembers.role })
    .from(costCenterMembers)
    .innerJoin(costCenters, eq(costCenters.id, costCenterMembers.costCenterId))
    .where(and(eq(costCenterMembers.userId, userId), eq(costCenters.status, 'approved')))
    .orderBy(costCenters.number);
  const defRole = rows.find((r) => r.id === def.id)?.role ?? 'user';
  return [{ id: def.id, number: def.number, name: def.name, role: defRole }, ...rows.filter((r) => r.id !== def.id)];
}

/**
 * F-KST-14: the owner of a cost center is a LiteLLM user, found by id (admins pick one) or by exact e-mail (requests).
 * Name and e-mail are taken from the portal account if there is one, otherwise from LiteLLM.
 */
export async function resolveOwner(deps: Deps, ref: { userId: string } | { email: string }) {
  const known =
    'userId' in ref ? await deps.litellm.getUser(ref.userId) : ((await deps.litellm.listUsers({ page: 1, pageSize: 1, email: ref.email })).items[0] ?? null);
  if (!known) throw new ApiError('OWNER_NOT_LITELLM_USER');
  const local = await deps.db.query.user.findFirst({ where: eq(user.id, known.userId) });
  if (local?.deletedAt) throw new ApiError('USER_DEACTIVATED');
  const email = local?.email ?? known.email;
  if (!email) throw new ApiError('OWNER_NOT_LITELLM_USER', 'The LiteLLM user has no e-mail');
  return { userId: known.userId, name: local?.name ?? known.alias ?? email, email };
}

/** Makes the owner of an approved cost center its admin (member row, LiteLLM team admin); mails them when they are new to it. */
export async function ensureOwnerIsAdmin(deps: Deps, actor: { id: string; name: string } | null, cc: CC) {
  if (!cc.ownerUserId || cc.isDefault || cc.status !== 'approved') return;
  const before = await getMembership(deps, cc.ownerUserId, cc.id);
  if (before?.role === 'admin') return;
  await deps.db
    .insert(costCenterMembers)
    .values({ costCenterId: cc.id, userId: cc.ownerUserId, email: cc.ownerEmail, role: 'admin', addedBy: actor?.id ?? null })
    .onConflictDoUpdate({ target: [costCenterMembers.costCenterId, costCenterMembers.userId], set: { role: 'admin' } });
  await syncTeamMembership(deps, cc.ownerUserId, cc.id);
  await audit(deps, { actorId: actor?.id ?? null, action: 'cost_center.member_add', entity: 'cost_center', entityId: cc.id, payload: { userId: cc.ownerUserId, role: 'admin', owner: true } });
  if (before) return;
  const vars = { number: cc.number, name: cc.name, actorName: actor?.name ?? '' };
  const local = await deps.db.query.user.findFirst({ where: eq(user.id, cc.ownerUserId) });
  if (local) await notifyUser(deps, local.id, 'cost_center_member_added', vars);
  else await notify(deps, { type: 'cost_center_member_added', to: cc.ownerEmail, locale: 'de', vars });
}

/**
 * Memberships written by SQL migrations (0006, 0008) never reached LiteLLM. Mirrors all of them once,
 * as soon as LiteLLM is reachable; later changes are mirrored as they happen.
 */
export async function syncMigratedMembershipsOnce(deps: Deps, key = 'litellm_team_members_synced:0008') {
  if (await deps.db.query.jobState.findFirst({ where: eq(jobState.key, key) })) return { synced: 0 };
  if (!(await deps.litellm.health()).ok) return { synced: 0 };
  const rows = await deps.db.query.costCenterMembers.findMany();
  for (const m of rows) await syncTeamMembership(deps, m.userId, m.costCenterId);
  await deps.db.insert(jobState).values({ key, value: { at: deps.now().toISOString(), count: rows.length } }).onConflictDoNothing();
  return { synced: rows.length };
}

function assertManageable(cc: CC) {
  if (cc.isDefault) throw new ApiError('COST_CENTER_DEFAULT_IMMUTABLE', 'Every user is a member of the default cost center');
}

function memberView(m: Member, u: UserRow | null) {
  return {
    userId: m.userId,
    email: u?.email ?? m.email,
    name: u?.name ?? null,
    role: m.role,
    status: !u ? ('never_signed_in' as const) : u.deletedAt ? ('deactivated' as const) : ('active' as const),
    addedBy: m.addedBy,
    addedAt: m.addedAt.toISOString(),
  };
}

async function getMember(deps: Deps, costCenterId: string, userId: string) {
  const m = await getMembership(deps, userId, costCenterId);
  if (!m) throw notFound('Member');
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  return memberView(m, u ?? null);
}

export async function listMembers(deps: Deps, costCenterId: string) {
  const cc = await getCostCenter(deps, costCenterId);
  assertManageable(cc);
  const rows = await deps.db
    .select({ m: costCenterMembers, u: user })
    .from(costCenterMembers)
    .leftJoin(user, eq(user.id, costCenterMembers.userId))
    .where(eq(costCenterMembers.costCenterId, cc.id));
  const items = rows.map((r) => memberView(r.m, r.u));
  // Admins first, then by e-mail.
  items.sort((a, b) => (a.role === b.role ? (a.email ?? a.userId).localeCompare(b.email ?? b.userId) : a.role === 'admin' ? -1 : 1));
  return items;
}

/** F-KST-11: candidates come from LiteLLM, the user master (E-7), including people who never signed in. */
export async function searchMemberCandidates(deps: Deps, costCenterId: string, q: string) {
  const cc = await getCostCenter(deps, costCenterId);
  assertManageable(cc);
  const r = await deps.litellm.listUsers({ page: 1, pageSize: 20, search: q });
  const ids = r.items.map((u) => u.userId);
  if (!ids.length) return [];
  const [members, local] = await Promise.all([
    deps.db.query.costCenterMembers.findMany({ where: and(eq(costCenterMembers.costCenterId, cc.id), inArray(costCenterMembers.userId, ids)) }),
    deps.db.query.user.findMany({ where: inArray(user.id, ids), columns: { id: true } }),
  ]);
  const memberIds = new Set(members.map((m) => m.userId));
  const localIds = new Set(local.map((l) => l.id));
  return r.items.map((u) => ({ userId: u.userId, email: u.email, alias: u.alias, hasAccount: localIds.has(u.userId), isMember: memberIds.has(u.userId) }));
}

/**
 * F-KST-13: only the owner (and global admins) appoint, demote or remove cost center admins; other cost center
 * admins manage plain members. The owner always stays admin, so a cost center never loses its last admin.
 */
function assertMayManageAdmins(actor: CurrentUser, cc: CC) {
  if (actor.role === 'admin' || (cc.ownerUserId !== null && actor.id === cc.ownerUserId)) return;
  throw new ApiError('COST_CENTER_OWNER_ONLY');
}

export async function addMember(deps: Deps, actor: CurrentUser, costCenterId: string, input: { userId: string; role: CostCenterMemberRole }) {
  const cc = await getCostCenter(deps, costCenterId);
  assertManageable(cc);
  if (cc.status !== 'approved') throw new ApiError('COST_CENTER_NOT_APPROVED');
  if (input.role === 'admin') assertMayManageAdmins(actor, cc);
  if (await getMembership(deps, input.userId, cc.id)) throw new ApiError('COST_CENTER_MEMBER_EXISTS');
  // F-KST-11: only users LiteLLM already knows can be added.
  const known = await deps.litellm.getUser(input.userId);
  if (!known) throw notFound('LiteLLM user');
  const local = (await deps.db.query.user.findFirst({ where: eq(user.id, input.userId) })) ?? null;
  if (local?.deletedAt) throw new ApiError('USER_DEACTIVATED');
  const inserted = await deps.db
    .insert(costCenterMembers)
    .values({ costCenterId: cc.id, userId: input.userId, email: local?.email ?? known.email, role: input.role, addedBy: actor.id })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) throw new ApiError('COST_CENTER_MEMBER_EXISTS');
  if (local) {
    // The first own cost center replaces the default in the profile, so new keys preselect it.
    const def = await getDefaultCostCenter(deps);
    if (!local.costCenterId || local.costCenterId === def.id) {
      await deps.db.update(user).set({ costCenterId: cc.id, updatedAt: deps.now() }).where(eq(user.id, local.id));
    }
  }
  await unblockKeysOfMember(deps, input.userId, cc.id, REMOVED_REASON);
  await syncTeamMembership(deps, input.userId, cc.id);
  await audit(deps, { actorId: actor.id, action: 'cost_center.member_add', entity: 'cost_center', entityId: cc.id, payload: { userId: input.userId, role: input.role } });
  const vars = { number: cc.number, name: cc.name, actorName: actor.name };
  if (local) await notifyUser(deps, local.id, 'cost_center_member_added', vars);
  else if (known.email) await notify(deps, { type: 'cost_center_member_added', to: known.email, locale: 'de', vars });
  return memberView(inserted[0]!, local);
}

export async function updateMember(deps: Deps, actor: CurrentUser, costCenterId: string, userId: string, role: CostCenterMemberRole) {
  const cc = await getCostCenter(deps, costCenterId);
  assertManageable(cc);
  const m = await getMembership(deps, userId, cc.id);
  if (!m) throw notFound('Member');
  if (m.role === role) return getMember(deps, cc.id, userId);
  if (cc.ownerUserId === userId) throw new ApiError('COST_CENTER_OWNER_MUST_BE_ADMIN');
  // With two roles every change appoints or demotes an admin.
  assertMayManageAdmins(actor, cc);
  await deps.db
    .update(costCenterMembers)
    .set({ role })
    .where(and(eq(costCenterMembers.userId, userId), eq(costCenterMembers.costCenterId, cc.id)));
  await syncTeamMembership(deps, userId, cc.id);
  await audit(deps, { actorId: actor.id, action: 'cost_center.member_role', entity: 'cost_center', entityId: cc.id, payload: { userId, from: m.role, to: role } });
  await notifyUser(deps, userId, 'role_changed', {
    role: role === 'admin' ? 'cost_center_admin' : 'user',
    detail: ` (${formatCostCenter(cc.number)} ${cc.name})`,
  });
  return getMember(deps, cc.id, userId);
}

export async function removeMember(deps: Deps, actor: CurrentUser, costCenterId: string, userId: string) {
  const cc = await getCostCenter(deps, costCenterId);
  assertManageable(cc);
  const m = await getMembership(deps, userId, cc.id);
  if (!m) throw notFound('Member');
  if (cc.ownerUserId === userId) throw new ApiError('COST_CENTER_OWNER_MUST_BE_ADMIN');
  if (m.role === 'admin') assertMayManageAdmins(actor, cc);
  await deps.db.delete(costCenterMembers).where(and(eq(costCenterMembers.userId, userId), eq(costCenterMembers.costCenterId, cc.id)));
  const local = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  if (local?.costCenterId === cc.id) {
    const def = await getDefaultCostCenter(deps);
    await deps.db.update(user).set({ costCenterId: def.id, updatedAt: deps.now() }).where(eq(user.id, userId));
  }
  await blockKeysOfMember(deps, userId, cc.id, REMOVED_REASON);
  await syncTeamMembership(deps, userId, cc.id);
  await audit(deps, { actorId: actor.id, action: 'cost_center.member_remove', entity: 'cost_center', entityId: cc.id, payload: { userId, role: m.role } });
  const vars = { number: cc.number, name: cc.name, actorName: actor.name };
  if (local) await notifyUser(deps, userId, 'cost_center_member_removed', vars);
  else if (m.email) await notify(deps, { type: 'cost_center_member_removed', to: m.email, locale: 'de', vars });
}
