import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

function createTransport() {
  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) return null;

  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass
    }
  });
}

type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  attachments?: Mail.Attachment[];
};

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@');
  if (!domain) return '***';
  return `${localPart.slice(0, 2)}***@${domain}`;
}

export async function sendMail({ to, subject, html, attachments = [] }: SendMailInput) {
  const transport = createTransport();
  if (!transport) {
    logger.info('mail:mock', { to: maskEmail(to), subject });
    return;
  }

  await transport.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    attachments
  });
  logger.info('mail:sent', { to: maskEmail(to), subject, attachmentCount: attachments.length });
}

export async function checkMailHealth() {
  const transport = createTransport();
  if (!transport) return { ok: true, configured: false };
  await transport.verify();
  return { ok: true, configured: true };
}
