import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const internalAlertTypes = [
  'automation',
  'inbox',
  'ticket',
  'system'
] as const;

export const internalAlertSeverities = [
  'info',
  'warning',
  'critical'
] as const;

const internalAlertSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  type: { type: String, enum: internalAlertTypes, default: 'automation', index: true },
  title: { type: String, required: true, trim: true },
  message: { type: String, trim: true },
  severity: { type: String, enum: internalAlertSeverities, default: 'info', index: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', index: true },
  automationExecution: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationExecution', index: true },
  automationStepKey: { type: String, trim: true },
  readAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

internalAlertSchema.index({ company: 1, targetUser: 1, readAt: 1, createdAt: -1 });
internalAlertSchema.index({ company: 1, severity: 1, createdAt: -1 });
internalAlertSchema.index({ company: 1, automationExecution: 1, createdAt: -1 });

export type IInternalAlert = InferSchemaType<typeof internalAlertSchema> & {
  _id: Types.ObjectId;
};

export const InternalAlert = mongoose.model<IInternalAlert>('InternalAlert', internalAlertSchema);
