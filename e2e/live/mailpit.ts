import { expect } from '@playwright/test';
import { MAILPIT_URL } from './env';

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function search(to: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=200`);
  if (!res.ok) throw new Error(`Mailpit search -> ${res.status}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages ?? [];
}

/** Waits until a mail to `to` with a subject matching `subject` arrives (plan decision f). */
export async function expectMail(to: string, subject: RegExp, timeout = 20_000) {
  await expect.poll(async () => (await search(to)).map((m) => m.Subject).find((s) => subject.test(s)) ?? null, { timeout, message: `mail to ${to} matching ${subject}` }).not.toBeNull();
}

export async function mailpitReachable() {
  try {
    return (await fetch(`${MAILPIT_URL}/api/v1/info`)).ok;
  } catch {
    return false;
  }
}
