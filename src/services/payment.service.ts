import { env } from '../config/env.js';
import { findPlan } from '../config/plans.js';
import { Company } from '../models/Company.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { isValidObjectId, type HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { HttpError } from '../utils/httpError.js';
import { generateStrongPassword, hashPassword } from '../utils/password.js';
import { createInvoiceNumber, sendInvoice } from './invoice.service.js';
import { initializePayment, verifyPayment } from './moneroo.service.js';

type CreatePaymentInput = {
  companySlug?: string;
  planCode: string;
  email?: string;
};

export async function createPayment({ companySlug, planCode, email }: CreatePaymentInput) {
  const company = companySlug ? await Company.findOne({ slug: companySlug }) : null;
  if (!company) throw new HttpError(404, 'Entreprise introuvable.');
  return createPaymentForCompany(company, planCode, email);
}

export async function createPaymentForCompany(company: HydratedDocument<ICompany>, planCode: string, email?: string) {
  const plan = findPlan(planCode);
  if (!plan) throw new HttpError(400, 'Forfait invalide.');
  const moneroWalletAddress = env.monero.walletAddress || 'managed-by-moneroo';

  if (email && email.toLowerCase() !== company.email) {
    company.email = email.toLowerCase();
    await company.save();
  }

  const payment = await Payment.create({
    company: company._id,
    planCode: plan.code,
    messages: plan.messages,
    amountFcfa: plan.priceFcfa,
    moneroWalletAddress,
    provider: 'moneroo',
    currency: env.moneroo.currency
  });

  const monerooPayment = await initializePayment({
    company,
    paymentId: String(payment._id),
    amount: payment.amountFcfa,
    description: `QR Feedback - ${plan.label}`,
    customerEmail: company.email,
    customerName: company.name,
    metadata: {
      payment_id: String(payment._id),
      company_id: String(company._id),
      plan_code: plan.code,
      messages: String(plan.messages)
    }
  });

  payment.providerPaymentId = monerooPayment.providerPaymentId;
  payment.checkoutUrl = monerooPayment.checkoutUrl;
  await payment.save();

  return {
    id: payment._id,
    status: payment.status,
    amountFcfa: payment.amountFcfa,
    moneroWalletAddress: payment.moneroWalletAddress,
    network: env.monero.network,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    checkoutUrl: payment.checkoutUrl,
    currency: payment.currency
  };
}

export async function confirmPayment(paymentId: string) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new HttpError(404, 'Paiement introuvable.');
  if (payment.status === 'paid') return payment;

  const company = await Company.findById(payment.company);
  if (!company) throw new HttpError(404, 'Entreprise introuvable.');

  if (payment.provider === 'moneroo' && payment.providerPaymentId) {
    const verified = await verifyPayment(company, payment.providerPaymentId);
    if (verified?.status !== 'success') {
      throw new HttpError(400, 'Paiement Moneroo non confirmé.');
    }
  }

  let temporaryPassword: string | undefined;
  let user = await User.findOne({ company: company._id });
  if (!user) {
    temporaryPassword = generateStrongPassword();
    user = await User.create({
      company: company._id,
      email: company.email,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true
    });
    company.user = user._id;
  }

  company.paidMessagesBalance += payment.messages;
  company.limitReachedAt = undefined;
  company.set('reminderSchedule', []);
  await company.save();

  payment.status = 'paid';
  payment.paidAt = new Date();
  payment.invoiceNumber = createInvoiceNumber();
  await payment.save();

  await sendInvoice({ company, payment, temporaryPassword });
  return payment;
}

export async function confirmPaymentReference(reference: string) {
  if (isValidObjectId(reference)) {
    return confirmPayment(reference);
  }

  return confirmPaymentByProviderId(reference);
}

export async function confirmPaymentByProviderId(providerPaymentId: string) {
  const payment = await Payment.findOne({ providerPaymentId });
  if (!payment) throw new HttpError(404, 'Paiement introuvable.');
  return confirmPayment(String(payment._id));
}

export async function processMonerooWebhook(payload: unknown, signature: string | undefined) {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { event?: string; data?: { id?: string; status?: string } })
    : null;

  const providerPaymentId = data?.data?.id;
  if (!providerPaymentId) throw new HttpError(400, 'Payload Moneroo invalide.');

  const payment = await Payment.findOne({ providerPaymentId });
  if (!payment) throw new HttpError(404, 'Paiement introuvable.');

  const company = await Company.findById(payment.company);
  if (!company) throw new HttpError(404, 'Entreprise introuvable.');

  const { verifyWebhookSignature } = await import('./moneroo.service.js');
  const signatureIsValid = await verifyWebhookSignature(company, payload, signature);
  if (!signatureIsValid) throw new HttpError(403, 'Signature Moneroo invalide.');

  if (data.event === 'payment.success' || data.data?.status === 'success') {
    await confirmPaymentByProviderId(providerPaymentId);
  }

  if (data.event === 'payment.failed' || data.event === 'payment.cancelled') {
    payment.status = 'cancelled';
    await payment.save();
  }
}
