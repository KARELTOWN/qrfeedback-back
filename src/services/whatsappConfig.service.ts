import crypto from 'crypto';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import {
  CompanyWhatsappConfig,
  type ICompanyWhatsappConfig
} from '../models/CompanyWhatsappConfig.js';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/encryption.js';
import { HttpError } from '../utils/httpError.js';

type SaveCompanyWhatsappConfigInput = {
  company: HydratedDocument<ICompany>;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string;
  webhookVerifyToken?: string;
  webhookSecret?: string;
  displayPhoneNumber?: string;
  status?: 'pending' | 'active' | 'disabled' | 'error';
};

function hashSecret(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function getActiveWhatsappConfig(companyId: string) {
  return CompanyWhatsappConfig.findOne({
    company: companyId,
    provider: 'whatsapp_cloud_api',
    status: 'active'
  });
}

export function getWhatsappAccessToken(config: HydratedDocument<ICompanyWhatsappConfig>) {
  return decryptSecret(config.accessTokenEncrypted);
}

export async function saveCompanyWhatsappConfig({
  company,
  wabaId,
  phoneNumberId,
  accessToken,
  businessAccountId,
  webhookVerifyToken,
  webhookSecret,
  displayPhoneNumber,
  status = 'active'
}: SaveCompanyWhatsappConfigInput) {
  if (!accessToken.trim()) throw new HttpError(400, 'Access token WhatsApp requis.');

  const update = {
    company: company._id,
    provider: 'whatsapp_cloud_api',
    wabaId: wabaId.trim(),
    phoneNumberId: phoneNumberId.trim(),
    businessAccountId: businessAccountId?.trim(),
    accessTokenEncrypted: encryptSecret(accessToken.trim()),
    webhookVerifyTokenEncrypted: webhookVerifyToken ? encryptSecret(webhookVerifyToken.trim()) : undefined,
    webhookSecretEncrypted: webhookSecret ? encryptSecret(webhookSecret.trim()) : undefined,
    webhookVerifyTokenHash: webhookVerifyToken ? hashSecret(webhookVerifyToken.trim()) : undefined,
    displayPhoneNumber: displayPhoneNumber?.trim(),
    status,
    lastVerifiedAt: new Date(),
    lastError: undefined
  };

  return CompanyWhatsappConfig.findOneAndUpdate(
    { company: company._id, phoneNumberId: phoneNumberId.trim() },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export function serializeWhatsappConfig(config: HydratedDocument<ICompanyWhatsappConfig>) {
  return {
    id: config._id,
    provider: config.provider,
    wabaId: config.wabaId,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    displayPhoneNumber: config.displayPhoneNumber,
    status: config.status,
    accessToken: maskSecret(getWhatsappAccessToken(config)),
    lastVerifiedAt: config.lastVerifiedAt,
    lastError: config.lastError,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}
