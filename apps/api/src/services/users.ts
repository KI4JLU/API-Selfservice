import { account, and, apiKeys, costCenterMembers, costCenterRequests, costCenters, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, user } from '@api-selfservice/db';
import { DEFAULT_COST_CENTER, type Role } from '@api-selfservice/shared';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, notFound } from '../errors.js';
import { audit, auditError } from './audit.js';
import { notifyAdmins, notifyUser } from './notifications.js';
import { blockAllKeysOfUser, unblockKeysOfUser } from './keys.js';
import { getDefaultCostCenter, syncTeamMembership } from './cost-centers.js';
import { getMembership, memberCostCenters } from './cost-center-members.js';
import { getBudgetState } from './budgets.js';
import { KEYCLOAK_PROVIDER_ID } from '../auth/claims.js';

/**
 * LiteLLM is the user master (PRD E-7). Before API-Selfservice creates a user on first login, an existing
 * LiteLLM user with the same e-mail is adopted: its `user_id` becomes the API-Selfservice user id.
 */
export async function findLitellmUserIdByEmail(deps: Deps, email: string): Promise<string | null> {
  try {
    const r = await deps.litellm.listUsers({ page: 1, pageSize: 5, email });
    return r.items[0]?.userId ?? null;
  } catch (e) {
    await auditError(deps, { action: 'litellm.list_users', entity: 'user', err: e, payload: { email, effect: 'creating a new LiteLLM user' } });
    return null;
  }
}

/**
 * First login (F-AUTH-2): registers the user in LiteLLM under the same id (unless adopted) and in the default team.
 * Cost centers an adopted LiteLLM user was added to before (F-KST-11) apply right away.
 */
export async function onUserCreated(deps: Deps, u: { id: string; email: string; name: string }) {
  const def = await getDefaultCostCenter(deps);
  let adopted = false;
  try {
    const existing = await deps.litellm.getUser(u.id);
    adopted = existing !== null;
    if (!existing) await deps.litellm.createUser({ userId: u.id, email: u.email, alias: u.name });
  } catch (e) {
    await auditError(deps, { action: 'litellm.create_user', entity: 'user', entityId: u.id, err: e });
  }
  const own = (await memberCostCenters(deps, u.id)).find((c) => c.id !== def.id);
  await deps.db
    .update(user)
    .set({ costCenterId: own?.id ?? def.id, updatedAt: deps.now() })
    .where(eq(user.id, u.id));
  await audit(deps, { actorId: null, action: 'user.create', entity: 'user', entityId: u.id, payload: { email: u.email, adoptedFromLitellm: adopted } });
  await syncTeamMembership(deps, u.id, def.id);
}

/** Keycloak subjects of the given users (from the Better Auth account table). */
export async function keycloakSubjects(deps: Deps, userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await deps.db.query.account.findMany({ where: and(eq(account.providerId, KEYCLOAK_PROVIDER_ID), inArray(account.userId, userIds)) });
  return new Map(rows.map((r) => [r.userId, r.accountId]));
}

/** Called on every login with claims from the ID token. */
export async function syncIdpClaims(
  deps: Deps,
  userId: string,
  claims: { sub: string | null; affiliation: string[]; isAdmin: boolean; affiliationValid: boolean } | null,
  opts: { touchLogin?: boolean } = {},
) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) return;
  const patch: Partial<typeof user.$inferInsert> = { updatedAt: deps.now() };
  if (opts.touchLogin !== false) patch.lastLoginAt = deps.now();
  if (claims) {
    if (claims.sub && opts.touchLogin !== false) {
      // Keep the SSO reference in LiteLLM complete (sso_user_id = Keycloak subject).
      try {
        await deps.litellm.updateUser(userId, { ssoUserId: claims.sub });
      } catch (e) {
        await auditError(deps, { action: 'litellm.update_user', entity: 'user', entityId: userId, err: e, payload: { field: 'sso_user_id' } });
      }
    }
    patch.affiliation = claims.affiliation;
    patch.affiliationValid = claims.affiliationValid;
    if (claims.isAdmin) {
      patch.role = 'admin';
      patch.roleFromIdp = true;
    } else if (u.roleFromIdp) {
      // group membership was removed: fall back to user unless an admin re-grants
      patch.role = 'user';
      patch.roleFromIdp = false;
    }
    if (!claims.affiliationValid && !u.deletedAt) {
      await deactivateUser(deps, userId, 'affiliation', null);
    } else if (claims.affiliationValid && u.deletedAt && u.deletedReason === 'affiliation') {
      // Account became valid again: reactivate automatically.
      await reactivateUser(deps, userId, null);
    }
  }
  await deps.db.update(user).set(patch).where(eq(user.id, userId));
}

/** Admin lookup in LiteLLM (the user master, E-7) with the matching API-Selfservice account per row. */
export async function searchLitellmUsers(deps: Deps, q: { page: number; pageSize: number; q?: string }) {
  const search = q.q?.trim() || undefined;
  const r = await deps.litellm.listUsers({ page: q.page, pageSize: q.pageSize, search });
  const ids = r.items.map((u) => u.userId);
  const local = ids.length ? await deps.db.query.user.findMany({ where: inArray(user.id, ids), columns: { id: true, name: true, deletedAt: true } }) : [];
  const byId = new Map(local.map((l) => [l.id, l]));
  return {
    items: r.items.map((u) => {
      const l = byId.get(u.userId);
      return {
        userId: u.userId,
        email: u.email,
        alias: u.alias,
        maxBudget: u.maxBudget,
        spend: u.spend,
        blocked: u.blocked,
        teams: u.teams,
        apiSelfservice: l ? { id: l.id, name: l.name, status: l.deletedAt ? ('deactivated' as const) : ('active' as const) } : null,
      };
    }),
    total: r.total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function loadCurrentUser(deps: Deps, userId: string): Promise<CurrentUser | null> {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) return null;
  if (u.deletedAt) throw new ApiError(u.deletedReason === 'affiliation' ? 'ACCOUNT_INVALID_AFFILIATION' : 'ACCOUNT_DEACTIVATED');
  if (!u.affiliationValid) throw new ApiError('ACCOUNT_INVALID_AFFILIATION');
  const managed = await deps.db.query.costCenterMembers.findMany({ where: and(eq(costCenterMembers.userId, u.id), eq(costCenterMembers.role, 'admin')) });
  const managedCostCenterIds = managed.map((m) => m.costCenterId);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    roleFromIdp: u.roleFromIdp,
    locale: u.locale,
    costCenterId: u.costCenterId,
    effectiveRole: u.role === 'admin' ? 'admin' : managedCostCenterIds.length ? 'cost_center_admin' : 'user',
    managedCostCenterIds,
  };
}

async function ccRef(deps: Deps, id: string | null) {
  const cc = id ? await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, id) }) : null;
  const c = cc ?? (await getDefaultCostCenter(deps));
  return { id: c.id, number: c.number, name: c.name };
}

async function managedRefs(deps: Deps, userId: string) {
  const rows = await deps.db
    .select({ id: costCenters.id, number: costCenters.number, name: costCenters.name })
    .from(costCenterMembers)
    .innerJoin(costCenters, eq(costCenters.id, costCenterMembers.costCenterId))
    .where(and(eq(costCenterMembers.userId, userId), eq(costCenterMembers.role, 'admin')));
  return rows;
}

export async function getMe(deps: Deps, cu: CurrentUser) {
  const u = (await deps.db.query.user.findFirst({ where: eq(user.id, cu.id) }))!;
  const pending = await deps.db
    .select({
      id: costCenterRequests.id,
      status: costCenterRequests.status,
      reason: costCenterRequests.reason,
      createdAt: costCenterRequests.createdAt,
      number: costCenters.number,
      name: costCenters.name,
    })
    .from(costCenterRequests)
    .innerJoin(costCenters, eq(costCenters.id, costCenterRequests.costCenterId))
    .where(eq(costCenterRequests.userId, cu.id))
    .orderBy(desc(costCenterRequests.createdAt))
    .limit(1);
  const p = pending[0];
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    effectiveRole: cu.effectiveRole,
    roleFromIdp: u.roleFromIdp,
    locale: u.locale,
    costCenter: await ccRef(deps, u.costCenterId),
    costCenterOwnerName: u.costCenterOwnerName,
    costCenterOwnerEmail: u.costCenterOwnerEmail,
    managedCostCenters: await managedRefs(deps, u.id),
    memberCostCenters: await memberCostCenters(deps, u.id),
    pendingRequest: p ? { id: p.id, number: p.number, name: p.name, status: p.status, reason: p.reason, createdAt: p.createdAt.toISOString() } : null,
  };
}

export async function updateMe(deps: Deps, cu: CurrentUser, input: { locale?: 'de' | 'en'; costCenterNumber?: string; costCenterOwnerName?: string | null; costCenterOwnerEmail?: string | null }) {
  const patch: Partial<typeof user.$inferInsert> = { updatedAt: deps.now() };
  if (input.locale) patch.locale = input.locale;
  if (input.costCenterOwnerName !== undefined) patch.costCenterOwnerName = input.costCenterOwnerName;
  if (input.costCenterOwnerEmail !== undefined) patch.costCenterOwnerEmail = input.costCenterOwnerEmail;
  let requestCreated: { number: string } | null = null;
  if (input.costCenterNumber !== undefined) {
    const { normalizeCostCenter } = await import('@api-selfservice/shared');
    const number = normalizeCostCenter(input.costCenterNumber);
    if (!number) throw new ApiError('VALIDATION_ERROR', 'Cost center must be 8 digits');
    const existing = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.number, number) });
    if (existing && existing.status === 'approved') {
      // F-KST-12: joining a cost center is up to its admins; the profile only switches between memberships.
      if (!existing.isDefault && !(await getMembership(deps, cu.id, existing.id))) throw new ApiError('COST_CENTER_NOT_MEMBER');
      patch.costCenterId = existing.id;
    } else if (existing && existing.status === 'archived') {
      throw new ApiError('COST_CENTER_NOT_APPROVED', 'Cost center is archived');
    } else {
      // unknown or pending -> request (needs owner data)
      // The owner must be a LiteLLM user (F-KST-14); without one, the requester is the owner.
      const ownerEmail = input.costCenterOwnerEmail ?? cu.email;
      const { requestCostCenter } = await import('./cost-centers.js');
      await requestCostCenter(deps, cu, { number, name: `Kostenstelle ${number}`, ownerEmail });
      requestCreated = { number };
    }
  }
  await deps.db.update(user).set(patch).where(eq(user.id, cu.id));
  return { me: await getMe(deps, cu), requestCreated };
}

// ---------- Admin ----------

export async function listUsers(deps: Deps, q: { page: number; pageSize: number; q?: string; costCenterId?: string; includeDeactivated: boolean }) {
  const where = and(
    q.includeDeactivated ? undefined : isNull(user.deletedAt),
    q.costCenterId ? eq(user.costCenterId, q.costCenterId) : undefined,
    q.q ? or(ilike(user.email, `%${q.q}%`), ilike(user.name, `%${q.q}%`)) : undefined,
  );
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(user).where(where);
  const rows = await deps.db.query.user.findMany({
    where,
    orderBy: [desc(user.createdAt)],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const items = [];
  for (const u of rows) items.push(await adminUserView(deps, u));
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
}

export async function getUserAdmin(deps: Deps, id: string) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, id) });
  if (!u) throw notFound('User');
  return adminUserView(deps, u);
}

async function adminUserView(deps: Deps, u: typeof user.$inferSelect) {
  const [{ keyCount } = { keyCount: 0 }] = await deps.db
    .select({ keyCount: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, u.id), ne(apiKeys.status, 'deleted')));
  const state = await getBudgetState(deps, u.id);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    roleFromIdp: u.roleFromIdp,
    locale: u.locale,
    costCenter: await ccRef(deps, u.costCenterId),
    managedCostCenters: await managedRefs(deps, u.id),
    budget: state.budget
      ? {
          amount: state.budget.amount,
          period: state.budget.period,
          periodStart: state.budget.periodStart?.toISOString() ?? null,
          periodEnd: state.budget.periodEnd?.toISOString() ?? null,
        }
      : null,
    spendCurrentPeriod: state.spend,
    keyCount: Number(keyCount),
    status: u.deletedAt ? ('deactivated' as const) : ('active' as const),
    deletedAt: u.deletedAt?.toISOString() ?? null,
    deletedReason: u.deletedReason,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function setRole(deps: Deps, actor: CurrentUser, targetId: string, role: Role) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, targetId) });
  if (!u) throw notFound('User');
  if (u.roleFromIdp && role !== 'admin') throw new ApiError('ROLE_MANAGED_BY_IDP');
  if (u.role === 'admin' && role !== 'admin') {
    const [{ admins } = { admins: 0 }] = await deps.db
      .select({ admins: count() })
      .from(user)
      .where(and(eq(user.role, 'admin'), isNull(user.deletedAt)));
    if (Number(admins) <= 1) throw new ApiError('LAST_ADMIN');
  }
  if (u.role !== role) {
    await deps.db.update(user).set({ role, updatedAt: deps.now() }).where(eq(user.id, targetId));
    await audit(deps, { actorId: actor.id, action: 'user.set_role', entity: 'user', entityId: targetId, payload: { from: u.role, to: role } });
    await notifyUser(deps, targetId, 'role_changed', { role, detail: '' });
  }
  return getUserAdmin(deps, targetId);
}

export async function setCostCenterAdmin(deps: Deps, actor: CurrentUser, targetId: string, costCenterIds: string[]) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, targetId) });
  if (!u) throw notFound('User');
  if (costCenterIds.length) {
    const found = await deps.db.query.costCenters.findMany({ where: inArray(costCenters.id, costCenterIds) });
    if (found.length !== new Set(costCenterIds).size) throw notFound('Cost center');
  }
  const def = await getDefaultCostCenter(deps);
  const before = await deps.db.query.costCenterMembers.findMany({ where: and(eq(costCenterMembers.userId, targetId), eq(costCenterMembers.role, 'admin')) });
  const dropped = before.map((b) => b.costCenterId).filter((id) => !costCenterIds.includes(id));
  // F-KST-14: owners stay admins of their cost centers until another owner is set.
  if (dropped.length) {
    const owned = await deps.db.query.costCenters.findFirst({ where: and(inArray(costCenters.id, dropped), eq(costCenters.ownerUserId, targetId)) });
    if (owned) throw new ApiError('COST_CENTER_OWNER_MUST_BE_ADMIN', `Owner of ${owned.number}`);
  }
  await deps.db.transaction(async (tx) => {
    // Admins taken off a cost center stay members of it (keys keep working); the default has no explicit members.
    for (const ccId of dropped) {
      const where = and(eq(costCenterMembers.userId, targetId), eq(costCenterMembers.costCenterId, ccId));
      if (ccId === def.id) await tx.delete(costCenterMembers).where(where);
      else await tx.update(costCenterMembers).set({ role: 'user' }).where(where);
    }
    for (const costCenterId of costCenterIds) {
      await tx
        .insert(costCenterMembers)
        .values({ userId: targetId, costCenterId, email: u.email, role: 'admin', addedBy: actor.id })
        .onConflictDoUpdate({ target: [costCenterMembers.costCenterId, costCenterMembers.userId], set: { role: 'admin' } });
    }
  });
  await audit(deps, { actorId: actor.id, action: 'user.set_cost_center_admin', entity: 'user', entityId: targetId, payload: { costCenterIds } });
  for (const ccId of new Set([...before.map((b) => b.costCenterId), ...costCenterIds])) await syncTeamMembership(deps, targetId, ccId);
  await notifyUser(deps, targetId, 'role_changed', {
    role: costCenterIds.length ? 'cost_center_admin' : u.role,
    detail: costCenterIds.length ? ` (${costCenterIds.length})` : '',
  });
  return getUserAdmin(deps, targetId);
}

export async function deactivateUser(deps: Deps, targetId: string, reason: 'admin' | 'affiliation', actorId: string | null) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, targetId) });
  if (!u) throw notFound('User');
  if (actorId && actorId === targetId) throw new ApiError('SELF_DEACTIVATION');
  if (u.deletedAt) return getUserAdmin(deps, targetId);
  await deps.db.update(user).set({ deletedAt: deps.now(), deletedReason: reason, updatedAt: deps.now() }).where(eq(user.id, targetId));
  await blockAllKeysOfUser(deps, targetId, reason === 'admin' ? 'user_deactivated' : 'affiliation_invalid');
  try {
    await deps.litellm.blockUser(targetId, true);
  } catch (e) {
    await auditError(deps, { action: 'litellm.block_user', entity: 'user', entityId: targetId, err: e, actorId });
  }
  // Automatic deactivation (account no longer entitled) is an alert; an admin's decision is a plain change.
  await audit(deps, { actorId, action: 'user.deactivate', entity: 'user', entityId: targetId, payload: { reason }, severity: reason === 'affiliation' ? 'warning' : 'info' });
  const type = reason === 'admin' ? 'user_deactivated' : 'account_invalid_deactivated';
  await notifyUser(deps, targetId, type);
  await notifyAdmins(deps, type, { userEmail: u.email, userName: u.name });
  return getUserAdmin(deps, targetId);
}

export async function reactivateUser(deps: Deps, targetId: string, actorId: string | null) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, targetId) });
  if (!u) throw notFound('User');
  if (!u.deletedAt) return getUserAdmin(deps, targetId);
  await deps.db.update(user).set({ deletedAt: null, deletedReason: null, affiliationValid: true, updatedAt: deps.now() }).where(eq(user.id, targetId));
  try {
    await deps.litellm.blockUser(targetId, false);
  } catch (e) {
    await auditError(deps, { action: 'litellm.unblock_user', entity: 'user', entityId: targetId, err: e, actorId });
  }
  // Keys stay blocked (F-USR-3); only budget-related blocks are lifted elsewhere.
  await unblockKeysOfUser(deps, targetId, ['none']);
  await audit(deps, { actorId, action: 'user.reactivate', entity: 'user', entityId: targetId });
  return getUserAdmin(deps, targetId);
}

/** Users whose deactivation exceeds the retention period. */
export async function usersDueForDeletion(deps: Deps) {
  const cutoff = new Date(deps.now().getTime() - deps.env.DELETION_GRACE_DAYS * 86400000);
  const rows = await deps.db.query.user.findMany({ where: isNotNull(user.deletedAt) });
  return rows.filter((u) => u.deletedAt && u.deletedAt <= cutoff);
}
