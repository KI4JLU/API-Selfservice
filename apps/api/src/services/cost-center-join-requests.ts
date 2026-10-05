import { and, costCenterJoinRequests, costCenterMembers, costCenters, desc, eq, inArray, user } from '@api-selfservice/db';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, notFound } from '../errors.js';
import { audit } from './audit.js';
import { notify, notifyUser } from './notifications.js';
import { getCostCenter } from './cost-centers.js';
import { addMember, getMembership } from './cost-center-members.js';

// ---------- Join requests (F-KST-16): users ask, cost center admins or admins decide ----------

type JoinRequest = typeof costCenterJoinRequests.$inferSelect;

async function joinRequestViews(deps: Deps, where: ReturnType<typeof and>) {
  const rows = await deps.db
    .select({ req: costCenterJoinRequests, u: { id: user.id, name: user.name, email: user.email }, cc: { id: costCenters.id, number: costCenters.number, name: costCenters.name } })
    .from(costCenterJoinRequests)
    .innerJoin(user, eq(user.id, costCenterJoinRequests.userId))
    .innerJoin(costCenters, eq(costCenters.id, costCenterJoinRequests.costCenterId))
    .where(where)
    .orderBy(desc(costCenterJoinRequests.createdAt));
  return rows.map((r) => ({
    id: r.req.id,
    user: r.u,
    costCenter: r.cc,
    message: r.req.message,
    status: r.req.status,
    reason: r.req.reason,
    decidedBy: r.req.decidedBy,
    decidedAt: r.req.decidedAt?.toISOString() ?? null,
    createdAt: r.req.createdAt.toISOString(),
  }));
}

async function joinRequestView(deps: Deps, id: string) {
  const [v] = await joinRequestViews(deps, eq(costCenterJoinRequests.id, id));
  if (!v) throw notFound('Join request');
  return v;
}

/** Owner and cost center admins of the cost center; they decide on join requests. */
async function joinRequestRecipients(deps: Deps, cc: typeof costCenters.$inferSelect) {
  const out = new Map<string, { email: string; locale: 'de' | 'en'; userId: string | null }>();
  if (cc.ownerUserId) out.set(cc.ownerEmail.toLowerCase(), { email: cc.ownerEmail, locale: 'de', userId: null });
  const admins = await deps.db
    .select({ memberEmail: costCenterMembers.email, email: user.email, locale: user.locale, id: user.id, deletedAt: user.deletedAt })
    .from(costCenterMembers)
    .leftJoin(user, eq(user.id, costCenterMembers.userId))
    .where(and(eq(costCenterMembers.costCenterId, cc.id), eq(costCenterMembers.role, 'admin')));
  for (const a of admins) {
    const email = a.email ?? a.memberEmail;
    if (email && !a.deletedAt) out.set(email.toLowerCase(), { email, locale: a.locale ?? 'de', userId: a.id });
  }
  return [...out.values()];
}

export async function listMyJoinRequests(deps: Deps, me: CurrentUser) {
  return joinRequestViews(deps, eq(costCenterJoinRequests.userId, me.id));
}

export async function createJoinRequest(deps: Deps, me: CurrentUser, input: { costCenterId: string; message?: string }) {
  const cc = await getCostCenter(deps, input.costCenterId);
  if (cc.isDefault) throw new ApiError('COST_CENTER_DEFAULT_IMMUTABLE', 'Every user is a member of the default cost center');
  if (cc.status !== 'approved') throw new ApiError('COST_CENTER_NOT_APPROVED');
  if (await getMembership(deps, me.id, cc.id)) throw new ApiError('COST_CENTER_MEMBER_EXISTS');
  const message = input.message?.trim() || null;
  const [created] = await deps.db.insert(costCenterJoinRequests).values({ costCenterId: cc.id, userId: me.id, message }).onConflictDoNothing().returning();
  if (!created) throw new ApiError('COST_CENTER_JOIN_REQUEST_PENDING');
  await audit(deps, { actorId: me.id, action: 'cost_center.join_request', entity: 'cost_center', entityId: cc.id, payload: { requestId: created.id } });
  const vars = { number: cc.number, name: cc.name, requesterName: me.name, requesterEmail: me.email, message: message ?? '' };
  for (const r of await joinRequestRecipients(deps, cc)) await notify(deps, { type: 'cost_center_join_request_created', to: r.email, locale: r.locale, userId: r.userId, vars });
  return joinRequestView(deps, created.id);
}

export async function listJoinRequests(deps: Deps, costCenterId: string, status?: JoinRequest['status']) {
  const cc = await getCostCenter(deps, costCenterId);
  return joinRequestViews(deps, and(eq(costCenterJoinRequests.costCenterId, cc.id), status ? eq(costCenterJoinRequests.status, status) : undefined));
}

/** Open requests of all cost centers the user decides on: every cost center for admins, the managed ones otherwise. */
export async function listPendingJoinRequests(deps: Deps, me: CurrentUser) {
  const pending = eq(costCenterJoinRequests.status, 'pending');
  if (me.role === 'admin') return joinRequestViews(deps, pending);
  if (me.managedCostCenterIds.length === 0) return [];
  return joinRequestViews(deps, and(pending, inArray(costCenterJoinRequests.costCenterId, me.managedCostCenterIds)));
}

async function getJoinRequest(deps: Deps, costCenterId: string, requestId: string) {
  const req = await deps.db.query.costCenterJoinRequests.findFirst({
    where: and(eq(costCenterJoinRequests.id, requestId), eq(costCenterJoinRequests.costCenterId, costCenterId)),
  });
  if (!req) throw notFound('Join request');
  return req;
}

/** Approval adds the requester as plain member; addMember mirrors to LiteLLM, audits and mails them (F-KST-10). */
export async function approveJoinRequest(deps: Deps, actor: CurrentUser, costCenterId: string, requestId: string) {
  const req = await getJoinRequest(deps, costCenterId, requestId);
  if (req.status !== 'pending') return joinRequestView(deps, req.id);
  if (!(await getMembership(deps, req.userId, costCenterId))) await addMember(deps, actor, costCenterId, { userId: req.userId, role: 'user' });
  await deps.db.update(costCenterJoinRequests).set({ status: 'approved', decidedBy: actor.id, decidedAt: deps.now() }).where(eq(costCenterJoinRequests.id, req.id));
  await audit(deps, { actorId: actor.id, action: 'cost_center.join_approve', entity: 'cost_center', entityId: costCenterId, payload: { requestId: req.id, userId: req.userId } });
  return joinRequestView(deps, req.id);
}

export async function rejectJoinRequest(deps: Deps, actor: CurrentUser, costCenterId: string, requestId: string, reason: string) {
  const req = await getJoinRequest(deps, costCenterId, requestId);
  if (req.status !== 'pending') return joinRequestView(deps, req.id);
  await deps.db.update(costCenterJoinRequests).set({ status: 'rejected', reason, decidedBy: actor.id, decidedAt: deps.now() }).where(eq(costCenterJoinRequests.id, req.id));
  const cc = await getCostCenter(deps, costCenterId);
  await audit(deps, { actorId: actor.id, action: 'cost_center.join_reject', entity: 'cost_center', entityId: cc.id, payload: { requestId: req.id, userId: req.userId, reason } });
  await notifyUser(deps, req.userId, 'cost_center_join_request_rejected', { number: cc.number, name: cc.name, reason, actorName: actor.name });
  return joinRequestView(deps, req.id);
}
