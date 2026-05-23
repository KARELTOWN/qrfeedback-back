import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationStatuses = ['draft', 'active', 'paused', 'archived'] as const;
export const automationEntryPolicies = [
  'allow_multiple',
  'once_per_contact',
  'once_per_contact_per_trigger'
] as const;

const automationSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  status: { type: String, enum: automationStatuses, default: 'draft', index: true },
  entryPolicy: { type: String, enum: automationEntryPolicies, default: 'allow_multiple' },
  timezone: { type: String, default: 'Africa/Lagos', trim: true },
  version: { type: Number, default: 1, min: 1 },
  publishedAt: { type: Date },
  archivedAt: { type: Date, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

automationSchema.index({ company: 1, status: 1 });
automationSchema.index({ company: 1, name: 1 });
automationSchema.index({ company: 1, updatedAt: -1 });
automationSchema.index({ company: 1, archivedAt: 1 });

export type IAutomation = InferSchemaType<typeof automationSchema> & {
  _id: Types.ObjectId;
};

export const Automation = mongoose.model<IAutomation>('Automation', automationSchema);
