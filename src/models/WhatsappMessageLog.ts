import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const whatsappMessageDirections = ['outbound', 'inbound'] as const;
export const whatsappMessageTypes = [
  'template',
  'text',
  'image',
  'document',
  'audio',
  'video',
  'interactive',
  'status'
] as const;
export const whatsappMessageStatuses = [
  'pending',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'received'
] as const;

const whatsappMessageLogSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  whatsappConfig: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyWhatsappConfig', index: true },
  contactMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactMessage', index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  direction: { type: String, enum: whatsappMessageDirections, required: true, index: true },
  type: { type: String, enum: whatsappMessageTypes, default: 'text', index: true },
  status: { type: String, enum: whatsappMessageStatuses, default: 'pending', index: true },
  providerMessageId: { type: String, trim: true, index: true },
  to: { type: String, trim: true },
  from: { type: String, trim: true },
  requestPayload: { type: mongoose.Schema.Types.Mixed },
  responsePayload: { type: mongoose.Schema.Types.Mixed },
  webhookPayload: { type: mongoose.Schema.Types.Mixed },
  estimatedCreditCost: { type: Number, default: 1, min: 1 },
  creditChargedAt: { type: Date },
  creditChargeSource: { type: String, enum: ['free', 'paid'] },
  creditRefundedAt: { type: Date },
  errorCode: { type: String, trim: true },
  errorMessage: { type: String },
  occurredAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

whatsappMessageLogSchema.index({ company: 1, status: 1, createdAt: -1 });
whatsappMessageLogSchema.index({ company: 1, creditChargedAt: -1 });
whatsappMessageLogSchema.index({ providerMessageId: 1, status: 1 });

export type IWhatsappMessageLog = InferSchemaType<typeof whatsappMessageLogSchema> & {
  _id: Types.ObjectId;
};

export const WhatsappMessageLog = mongoose.model<IWhatsappMessageLog>(
  'WhatsappMessageLog',
  whatsappMessageLogSchema
);
