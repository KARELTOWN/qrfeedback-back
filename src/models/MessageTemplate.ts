import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const messageTemplateProviders = ['whatsapp_cloud_api'] as const;
export const messageTemplateCategories = ['marketing', 'utility', 'authentication', 'service', 'unknown'] as const;
export const messageTemplateStatuses = ['draft', 'pending', 'approved', 'rejected', 'paused', 'disabled'] as const;

const messageTemplateSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  whatsappConfig: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyWhatsappConfig', index: true },
  provider: { type: String, enum: messageTemplateProviders, default: 'whatsapp_cloud_api', index: true },
  name: { type: String, required: true, trim: true },
  languageCode: { type: String, required: true, trim: true, default: 'fr' },
  category: { type: String, enum: messageTemplateCategories, default: 'unknown', index: true },
  status: { type: String, enum: messageTemplateStatuses, default: 'draft', index: true },
  components: { type: mongoose.Schema.Types.Mixed, default: [] },
  estimatedCreditCost: { type: Number, default: 1, min: 1 },
  externalId: { type: String, trim: true, index: true },
  rejectedReason: { type: String },
  lastSyncedAt: { type: Date },
  archivedAt: { type: Date, index: true }
}, { timestamps: true });

messageTemplateSchema.index(
  { company: 1, name: 1, languageCode: 1 },
  { unique: true, partialFilterExpression: { archivedAt: { $exists: false } } }
);
messageTemplateSchema.index({ company: 1, status: 1, updatedAt: -1 });

export type IMessageTemplate = InferSchemaType<typeof messageTemplateSchema> & {
  _id: Types.ObjectId;
};

export const MessageTemplate = mongoose.model<IMessageTemplate>('MessageTemplate', messageTemplateSchema);
