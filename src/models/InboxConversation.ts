import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const inboxConversationChannels = [
  'whatsapp',
  'email',
  'internal'
] as const;

export const inboxConversationStatuses = [
  'open',
  'pending',
  'closed'
] as const;

const inboxConversationSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  channel: { type: String, enum: inboxConversationChannels, default: 'whatsapp', index: true },
  status: { type: String, enum: inboxConversationStatuses, default: 'open', index: true },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  lastMessageAt: { type: Date, index: true },
  lastMessagePreview: { type: String, trim: true },
  unreadCount: { type: Number, default: 0, min: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

inboxConversationSchema.index({ company: 1, contact: 1, channel: 1, status: 1 });
inboxConversationSchema.index({ company: 1, assignee: 1, status: 1, lastMessageAt: -1 });
inboxConversationSchema.index({ company: 1, lastMessageAt: -1 });

export type IInboxConversation = InferSchemaType<typeof inboxConversationSchema> & {
  _id: Types.ObjectId;
};

export const InboxConversation = mongoose.model<IInboxConversation>(
  'InboxConversation',
  inboxConversationSchema
);
