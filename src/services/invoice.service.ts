import { sendMail } from './mail.service.js';
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

  await sendMail({
    to: company.email,
    subject: `Facture ${payment.invoiceNumber}`,
    html: `
      <p>Bonjour ${company.name},</p>
      <p>Votre paiement a été confirmé.</p>
      <p>Facture : <strong>${payment.invoiceNumber}</strong></p>
      <p>Forfait : ${payment.messages} messages - ${payment.amountFcfa} FCFA.</p>
      ${passwordBlock}
    `
  });
}
