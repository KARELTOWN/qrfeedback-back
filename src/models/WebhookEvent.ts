import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const webhookEventProviders = ['whatsapp_cloud_api'] as const;
export const webhookEventTypes = ['verification', 'message', 'status', 'template_status', 'unknown'] as const;
export const webhookEventProcessingStatuses = ['received', 'processing', 'processed', 'failed'] as const;

const webhookEventErrorSchema = new mongoose.Schema({
  message: { type: String },
  code: { type: String },
  details: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const webhookEventSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  whatsappConfig: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyWhatsappConfig', index: true },
  provider: { type: String, enum: webhookEventProviders, default: 'whatsapp_cloud_api', index: true },
  eventType: { type: String, enum: webhookEventTypes, default: 'unknown', index: true },
  externalEventId: { type: String, trim: true },
  phoneNumberId: { type: String, trim: true, index: true },
  signatureValid: { type: Boolean },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  processingStatus: { type: String, enum: webhookEventProcessingStatuses, default: 'received', index: true },
  error: { type: webhookEventErrorSchema },
  receivedAt: { type: Date, default: Date.now, index: true },
  processedAt: { type: Date }
}, { timestamps: true });

webhookEventSchema.index(
  { provider: 1, externalEventId: 1 },
  { unique: true, partialFilterExpression: { externalEventId: { $type: 'string' } } }
);
webhookEventSchema.index({ phoneNumberId: 1, receivedAt: -1 });
webhookEventSchema.index({ processingStatus: 1, receivedAt: 1 });

export type IWebhookEvent = InferSchemaType<typeof webhookEventSchema> & {
  _id: Types.ObjectId;
};

export const WebhookEvent = mongoose.model<IWebhookEvent>('WebhookEvent', webhookEventSchema);
