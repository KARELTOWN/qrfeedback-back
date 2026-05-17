import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { env } from '../config/env.js';

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

export async function sendMail({ to, subject, html, attachments = [] }: SendMailInput) {
  const transport = createTransport();
  if (!transport) {
    console.log('[mail:mock]', { to, subject });
    return;
  }

  await transport.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    attachments
  });
}
