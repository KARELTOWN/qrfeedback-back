import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const ticketSources = [
  'automation',
  'inbox',
  'manual'
] as const;

export const ticketStatuses = [
  'open',
  'pending',
  'resolved',
  'closed'
] as const;

export const ticketPriorities = [
  'low',
  'normal',
  'high',
  'urgent'
] as const;

const ticketSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'InboxConversation', index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  source: { type: String, enum: ticketSources, default: 'automation', index: true },
  status: { type: String, enum: ticketStatuses, default: 'open', index: true },
  priority: { type: String, enum: ticketPriorities, default: 'normal', index: true },
  subject: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', index: true },
  automationExecution: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationExecution', index: true },
  automationStepKey: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

ticketSchema.index({ company: 1, status: 1, priority: 1, createdAt: -1 });
ticketSchema.index({ company: 1, assignee: 1, status: 1, createdAt: -1 });
ticketSchema.index({ company: 1, contact: 1, createdAt: -1 });

export type ITicket = InferSchemaType<typeof ticketSchema> & {
  _id: Types.ObjectId;
};

export const Ticket = mongoose.model<ITicket>('Ticket', ticketSchema);
