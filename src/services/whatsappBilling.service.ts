import type { HydratedDocument, Types } from 'mongoose';
import { Company, type ICompany } from '../models/Company.js';
import { HttpError } from '../utils/httpError.js';
import { buildReminderSchedule } from './company.service.js';

export type WhatsappCreditCharge = {
  cost: number;
  source: 'free' | 'paid';
  chargedAt: Date;
};

export function estimateWhatsappCreditCost() {
  return {
    estimatedCreditCost: 1,
    pricingModel: 'platform_flat_credit_v1',
    reason: 'Facturation initiale simple: 1 message WhatsApp envoye = 1 credit plateforme.'
  };
}

async function markLimitReached(companyId: Types.ObjectId | string) {
  const limitReachedAt = new Date();
  await Company.updateOne(
    { _id: companyId, limitReachedAt: { $exists: false } },
    {
      $set: {
        limitReachedAt,
        reminderSchedule: buildReminderSchedule(limitReachedAt)
      }
    }
  );
}

export async function chargeWhatsappCredit(company: HydratedDocument<ICompany>, cost = 1): Promise<WhatsappCreditCharge> {
  if (cost !== 1) throw new HttpError(400, 'Le cout WhatsApp supporte actuellement est de 1 credit par message.');

  const chargedAt = new Date();
  const freeCharge = await Company.findOneAndUpdate(
    {
      _id: company._id,
      $expr: { $lt: ['$freeMessagesUsed', '$freeMessagesLimit'] }
    },
    {
      $inc: { freeMessagesUsed: 1 },
      $unset: { limitReachedAt: 1 },
      $set: { reminderSchedule: [] }
    },
    { new: true }
  );

  if (freeCharge) {
    company.freeMessagesUsed = freeCharge.freeMessagesUsed;
    company.paidMessagesBalance = freeCharge.paidMessagesBalance;
    company.limitReachedAt = freeCharge.limitReachedAt;
    company.reminderSchedule = freeCharge.reminderSchedule;
    return { cost, source: 'free', chargedAt };
  }

  const paidCharge = await Company.findOneAndUpdate(
    { _id: company._id, paidMessagesBalance: { $gte: cost } },
    {
      $inc: { paidMessagesBalance: -cost },
      $unset: { limitReachedAt: 1 },
      $set: { reminderSchedule: [] }
    },
    { new: true }
  );

  if (paidCharge) {
    company.freeMessagesUsed = paidCharge.freeMessagesUsed;
    company.paidMessagesBalance = paidCharge.paidMessagesBalance;
    company.limitReachedAt = paidCharge.limitReachedAt;
    company.reminderSchedule = paidCharge.reminderSchedule;
    return { cost, source: 'paid', chargedAt };
  }

  await markLimitReached(company._id);
  throw new HttpError(402, 'Credit WhatsApp insuffisant.');
}

export async function refundWhatsappCredit(companyId: Types.ObjectId | string, charge?: WhatsappCreditCharge) {
  if (!charge) return;
  if (charge.source === 'free') {
    await Company.updateOne(
      { _id: companyId, freeMessagesUsed: { $gt: 0 } },
      { $inc: { freeMessagesUsed: -charge.cost } }
    );
    return;
  }

  await Company.updateOne(
    { _id: companyId },
    { $inc: { paidMessagesBalance: charge.cost } }
  );
}
