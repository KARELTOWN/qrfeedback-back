import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const contactMessageChannels = ['whatsapp', 'email', 'internal'] as const;
export const contactMessageDirections = ['inbound', 'outbound'] as const;
export const contactMessageStatuses = [
  'pending',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'received'
] as const;

const contactMessageErrorSchema = new mongoose.Schema({
  code: { type: String, trim: true },
  message: { type: String },
  details: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const contactMessageSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'InboxConversation', index: true },
  automationExecution: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationExecution', index: true },
  automationStepKey: { type: String, trim: true },
  channel: { type: String, enum: contactMessageChannels, required: true, index: true },
  direction: { type: String, enum: contactMessageDirections, required: true, index: true },
  status: { type: String, enum: contactMessageStatuses, default: 'pending', index: true },
  to: { type: String, trim: true },
  from: { type: String, trim: true },
  body: { type: String },
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'MessageTemplate', index: true },
  templatePayload: { type: mongoose.Schema.Types.Mixed },
  providerMessageId: { type: String, trim: true, index: true },
  providerPayload: { type: mongoose.Schema.Types.Mixed },
  sentAt: { type: Date },
  deliveredAt: { type: Date },
  readAt: { type: Date },
  failedAt: { type: Date },
  error: { type: contactMessageErrorSchema }
}, { timestamps: true });

contactMessageSchema.index({ company: 1, contact: 1, createdAt: -1 });
contactMessageSchema.index({ company: 1, conversation: 1, createdAt: 1 });
contactMessageSchema.index({ providerMessageId: 1 }, { unique: true, sparse: true });

export type IContactMessage = InferSchemaType<typeof contactMessageSchema> & {
  _id: Types.ObjectId;
};

export const ContactMessage = mongoose.model<IContactMessage>('ContactMessage', contactMessageSchema);
