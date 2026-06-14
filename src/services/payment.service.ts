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
import { isKkiapayTransactionSuccessful, verifyKkiapayTransaction } from './kkiapay.service.js';

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
  if (email && email.toLowerCase() !== company.email) {
    company.email = email.toLowerCase();
    await company.save();
  }

  const payment = await Payment.create({
    company: company._id,
    planCode: plan.code,
    messages: plan.messages,
    whatsappMessages: plan.whatsappMessages,
    emailNotifications: plan.emailNotifications,
    amountFcfa: plan.priceFcfa,
    provider: 'kkiapay',
    currency: 'XOF'
  });

  return {
    id: payment._id,
    status: payment.status,
    amountFcfa: payment.amountFcfa,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    checkoutUrl: payment.checkoutUrl,
    currency: payment.currency,
    kkiapay: {
      publicKey: env.kkiapay.publicKey,
      sandbox: env.kkiapay.sandbox,
      amount: payment.amountFcfa,
      name: company.name,
      email: company.email
    }
  };
}

export async function confirmPayment(paymentId: string, transactionId?: string) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new HttpError(404, 'Paiement introuvable.');
  if (payment.status === 'paid') return payment;

  const company = await Company.findById(payment.company);
  if (!company) throw new HttpError(404, 'Entreprise introuvable.');

  if (payment.provider === 'kkiapay') {
    if (!transactionId) throw new HttpError(400, 'Transaction Kkiapay requise.');
    const transaction = await verifyKkiapayTransaction(transactionId);
    if (!isKkiapayTransactionSuccessful(transaction)) {
      throw new HttpError(400, 'Paiement Kkiapay non confirme.');
    }
    if (Number(transaction.amount || 0) < payment.amountFcfa) {
      throw new HttpError(400, 'Montant Kkiapay insuffisant.');
    }
    payment.providerPaymentId = transactionId;
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

  company.unlimitedAccess = true;
  company.unlimitedAccessActivatedAt = new Date();
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

export async function confirmPaymentReference(reference: string, transactionId?: string) {
  if (isValidObjectId(reference)) {
    return confirmPayment(reference, transactionId);
  }

  return confirmPaymentByProviderId(reference);
}

export async function confirmPaymentByProviderId(providerPaymentId: string) {
  const payment = await Payment.findOne({ providerPaymentId });
  if (!payment) throw new HttpError(404, 'Paiement introuvable.');
  return confirmPayment(String(payment._id));
}
