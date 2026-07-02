import pug from "pug";
import type Mail from "nodemailer/lib/mailer/index.js";
import { NotificationTemplate } from "../models/NotificationTemplate.js";
import { HttpError } from "../utils/httpError.js";
import { sendMail } from "./mail.service.js";

export type TemplateVariable = { key: string; label: string; description?: string };
export type NotificationTemplateInput = {
  name: string;
  label: string;
  emailTemplate?: string;
  smsTemplate?: string;
  emailTitle?: string;
  smsTitle?: string;
  emailVariables?: TemplateVariable[];
  smsVariables?: TemplateVariable[];
  isActive?: boolean;
};

const EMAIL_LAYOUT_PUG = `doctype html
html
  head
    meta(charset="utf-8")
    meta(name="viewport" content="width=device-width, initial-scale=1")
    title= title
  body(style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#102a43")
    table(role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px")
      tr
        td(align="center")
          table(role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(15,42,67,.10)")
            tr
              td(style="padding:28px 32px;background:#0f766e;color:#fff")
                div(style="font-size:20px;font-weight:700") Opinbase
                div(style="margin-top:6px;font-size:14px;opacity:.9")= title
            tr
              td(style="padding:32px;font-size:16px;line-height:1.65")!= bodyHtml
            tr
              td(style="padding:18px 32px;background:#f8fafc;color:#64748b;font-size:12px") Message envoyé par Opinbase.`;

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function replaceVariables(source: string, variables: Record<string, unknown>, escape = true) {
  return source.replace(/#([a-zA-Z][a-zA-Z0-9_]*)/g, (full, key: string) => {
    if (!(key in variables)) return full;
    const value = String(variables[key] ?? "");
    return escape ? escapeHtml(value) : value;
  });
}

export function renderNotificationEmail(template: { emailTitle: string; emailTemplate: string }, variables: Record<string, unknown>) {
  const title = replaceVariables(template.emailTitle, variables, false);
  const bodyHtml = replaceVariables(template.emailTemplate, variables, true);
  return { subject: title, html: pug.render(EMAIL_LAYOUT_PUG, { title, bodyHtml }) };
}

export function renderNotificationSms(template: { smsTitle: string; smsTemplate: string }, variables: Record<string, unknown>) {
  return { title: replaceVariables(template.smsTitle, variables, false), body: replaceVariables(template.smsTemplate, variables, false) };
}

export async function sendTemplateMail(input: { name: string; to: string; variables: Record<string, unknown>; attachments?: Mail.Attachment[]; subject?: string; html?: string }) {
  const template = await NotificationTemplate.findOne({ name: input.name, isActive: true });
  if (!template) throw new HttpError(500, `Modèle de notification actif introuvable : ${input.name}`);
  const rendered = renderNotificationEmail(template, input.variables);
  await sendMail({ to: input.to, subject: rendered.subject, html: rendered.html, attachments: input.attachments });
}

export async function listNotificationTemplates() { return { templates: await NotificationTemplate.find().sort({ name: 1 }).lean() }; }

export async function getNotificationTemplate(name: string) {
  const template = await NotificationTemplate.findOne({ name });
  if (!template) throw new HttpError(404, "Modèle de notification introuvable.");
  return { template };
}

export async function createNotificationTemplate(input: NotificationTemplateInput) {
  const template = await NotificationTemplate.create(normalizeTemplateInput(input));
  return { template };
}

export async function updateNotificationTemplate(name: string, input: Partial<NotificationTemplateInput>) {
  const template = await NotificationTemplate.findOneAndUpdate({ name }, { $set: normalizeTemplateInput(input) }, { new: true, runValidators: true });
  if (!template) throw new HttpError(404, "Modèle de notification introuvable.");
  return { template };
}

export async function previewNotificationTemplate(name: string, variables: Record<string, unknown>) {
  const { template } = await getNotificationTemplate(name);
  return { email: renderNotificationEmail(template, variables), sms: renderNotificationSms(template, variables) };
}

function normalizeTemplateInput(input: Partial<NotificationTemplateInput>) {
  const result: Record<string, unknown> = {};
  for (const field of ["name", "label", "emailTemplate", "smsTemplate", "emailTitle", "smsTitle", "isActive"] as const) {
    if (input[field] !== undefined) result[field] = typeof input[field] === "string" ? input[field].trim() : input[field];
  }
  for (const field of ["emailVariables", "smsVariables"] as const) {
    if (input[field] !== undefined) result[field] = input[field]?.map((item) => ({ key: item.key.trim(), label: item.label.trim(), description: item.description?.trim() }));
  }
  return result;
}
