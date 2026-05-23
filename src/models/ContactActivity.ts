import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const contactActivityTypes = [
  'contact_created',
  'contact_updated',
  'added_to_list',
  'removed_from_list',
  'tag_added',
  'tag_removed',
  'feedback_submitted',
  'message_sent',
  'message_delivered',
  'message_read',
  'message_failed',
  'automation_started',
  'automation_completed',
  'note_created'
] as const;

export type ContactActivityType = typeof contactActivityTypes[number];

export const contactActivityDirections = [
  'inbound',
  'outbound',
  'internal'
] as const;

export type ContactActivityDirection = typeof contactActivityDirections[number];

const contactActivitySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
  type: { type: String, enum: contactActivityTypes, required: true, index: true },
  channel: { type: String, enum: ['whatsapp'], index: true },
  direction: { type: String, enum: contactActivityDirections },
  provider: { type: String, enum: ['whatsapp_cloud_api'] },
  providerMessageId: { type: String, trim: true, index: true },
  title: { type: String, trim: true },
  description: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

contactActivitySchema.index({ company: 1, contact: 1, occurredAt: -1 });
contactActivitySchema.index({ company: 1, type: 1, occurredAt: -1 });
contactActivitySchema.index({ company: 1, channel: 1, occurredAt: -1 });

export type IContactActivity = InferSchemaType<typeof contactActivitySchema> & {
  _id: Types.ObjectId;
};

export const ContactActivity = mongoose.model<IContactActivity>('ContactActivity', contactActivitySchema);
