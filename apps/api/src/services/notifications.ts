import { and, eq, isNull, notifications, user } from '@litelite/db';
import type { Locale, NotificationType } from '@litelite/shared';
import type { Deps } from '../context.js';
import { renderMail } from '../mail/templates.js';

type Vars = Record<string, string | number | null | undefined>;

export async function notify(
  deps: Deps,
  input: { type: NotificationType; to: string; locale: Locale; userId?: string | null; vars?: Vars },
) {
  const { subject, text } = renderMail(input.type, input.locale, { appUrl: deps.env.APP_URL, ...input.vars });
  const res = await deps.mailer.send({ to: input.to, subject, text });
  await deps.db.insert(notifications).values({
    userId: input.userId ?? null,
    type: input.type,
    recipient: input.to,
    locale: input.locale,
    subject,
    status: res.ok ? 'sent' : 'failed',
    error: res.ok ? null : res.error,
  });
  if (!res.ok) deps.log.warn({ type: input.type, to: input.to, err: res.error }, 'mail failed');
  return res;
}

export async function notifyUser(deps: Deps, userId: string, type: NotificationType, vars?: Vars) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) return;
  return notify(deps, { type, to: u.email, locale: u.locale, userId, vars: { userName: u.name, userEmail: u.email, ...vars } });
}

/** Sends to ADMIN_NOTIFY_EMAILS if set, otherwise to all active admins. */
export async function notifyAdmins(deps: Deps, type: NotificationType, vars?: Vars) {
  if (deps.env.ADMIN_NOTIFY_EMAILS.length) {
    for (const to of deps.env.ADMIN_NOTIFY_EMAILS) await notify(deps, { type, to, locale: 'de', vars });
    return;
  }
  const admins = await deps.db.query.user.findMany({ where: and(eq(user.role, 'admin'), isNull(user.deletedAt)) });
  for (const a of admins) await notify(deps, { type, to: a.email, locale: a.locale, userId: a.id, vars });
}
