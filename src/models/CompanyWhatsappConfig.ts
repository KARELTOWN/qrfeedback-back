import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const whatsappConfigProviders = ['whatsapp_cloud_api'] as const;
export const whatsappConfigStatuses = ['pending', 'active', 'disabled', 'error'] as const;

const encryptedPayloadSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  tag: { type: String, required: true },
  keyVersion: { type: String, required: true }
}, { _id: false });

const companyWhatsappConfigSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  provider: { type: String, enum: whatsappConfigProviders, default: 'whatsapp_cloud_api', index: true },
  wabaId: { type: String, required: true, trim: true },
  phoneNumberId: { type: String, required: true, trim: true, unique: true, index: true },
  businessAccountId: { type: String, trim: true },
  accessTokenEncrypted: { type: encryptedPayloadSchema, required: true },
  webhookVerifyTokenEncrypted: { type: encryptedPayloadSchema },
  webhookSecretEncrypted: { type: encryptedPayloadSchema },
  webhookVerifyTokenHash: { type: String, index: true },
  displayPhoneNumber: { type: String, trim: true },
  status: { type: String, enum: whatsappConfigStatuses, default: 'pending', index: true },
  lastVerifiedAt: { type: Date },
  lastError: { type: String }
}, { timestamps: true });

companyWhatsappConfigSchema.index({ company: 1, status: 1 });
companyWhatsappConfigSchema.index({ company: 1, provider: 1 });

export type ICompanyWhatsappConfig = InferSchemaType<typeof companyWhatsappConfigSchema> & {
  _id: Types.ObjectId;
};

export const CompanyWhatsappConfig = mongoose.model<ICompanyWhatsappConfig>(
  'CompanyWhatsappConfig',
  companyWhatsappConfigSchema
);
