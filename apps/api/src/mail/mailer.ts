import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<{ ok: true } | { ok: false; error: string }>;
}

export function createMailer(env: Env): Mailer {
  const transporter: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  return {
    async send(msg) {
      try {
        await transporter.sendMail({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

/** Collects mails in memory (tests). */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      return { ok: true };
    },
  };
}
