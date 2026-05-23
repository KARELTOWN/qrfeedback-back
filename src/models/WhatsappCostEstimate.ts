import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const whatsappEstimateMessageTypes = ['text', 'template'] as const;

const whatsappCostEstimateSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  whatsappConfig: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyWhatsappConfig', index: true },
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'MessageTemplate', index: true },
  messageType: { type: String, enum: whatsappEstimateMessageTypes, required: true, index: true },
  recipient: { type: String, trim: true },
  recipientCountryCode: { type: String, trim: true, index: true },
  estimatedCreditCost: { type: Number, required: true, default: 1, min: 1 },
  pricingModel: { type: String, default: 'platform_flat_credit_v1' },
  reason: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

whatsappCostEstimateSchema.index({ company: 1, createdAt: -1 });
whatsappCostEstimateSchema.index({ company: 1, messageType: 1, createdAt: -1 });

export type IWhatsappCostEstimate = InferSchemaType<typeof whatsappCostEstimateSchema> & {
  _id: Types.ObjectId;
};

export const WhatsappCostEstimate = mongoose.model<IWhatsappCostEstimate>(
  'WhatsappCostEstimate',
  whatsappCostEstimateSchema
);
