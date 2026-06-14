import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const notificationPreferencesSchema = new mongoose.Schema({
  whatsappEnabled: { type: Boolean, default: true },
  emailEnabled: { type: Boolean, default: true },
  telegramEnabled: { type: Boolean, default: true }
}, { _id: false });

const companyQrCodeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  whatsappNumber: { type: String, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  feedbackUrl: { type: String, required: true },
  qrCodeDataUrl: { type: String, required: true },
  label: { type: String, trim: true },
  notificationPreferences: { type: notificationPreferencesSchema, default: () => ({}) }
}, { timestamps: true });

export type ICompanyQrCode = InferSchemaType<typeof companyQrCodeSchema> & {
  _id: Types.ObjectId;
};

export const CompanyQrCode = mongoose.model<ICompanyQrCode>('CompanyQrCode', companyQrCodeSchema);
