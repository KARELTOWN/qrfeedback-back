import { sendTemplateMail } from './notificationTemplate.service.js';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import type { IPayment } from '../models/Payment.js';

export function createInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `QRF-${date}-${suffix}`;
}

type SendInvoiceInput = {
  company: HydratedDocument<ICompany>;
  payment: HydratedDocument<IPayment>;
  temporaryPassword?: string;
};

export async function sendInvoice({ company, payment, temporaryPassword }: SendInvoiceInput) {
  const passwordBlock = temporaryPassword
    ? `<p>Votre mot de passe temporaire est : <strong>${temporaryPassword}</strong></p>`
    : '<p>Vous pouvez vous connecter avec votre mot de passe habituel.</p>';

  await sendTemplateMail({
    name: 'invoice-issued',
    to: company.email,
    variables: { companyName: company.name, invoiceNumber: payment.invoiceNumber, amountFcfa: payment.amountFcfa, passwordMessage: temporaryPassword ? `Votre mot de passe temporaire est : ${temporaryPassword}` : 'Vous pouvez vous connecter avec votre mot de passe habituel.' },
    subject: `Facture ${payment.invoiceNumber}`,
    html: `
      <p>Bonjour ${company.name},</p>
      <p>Votre paiement a été confirmé.</p>
      <p>Facture : <strong>${payment.invoiceNumber}</strong></p>
      <p>Forfait : acces illimite a la plateforme Opinbase - ${payment.amountFcfa} FCFA.</p>
      ${passwordBlock}
    `
  });
}
