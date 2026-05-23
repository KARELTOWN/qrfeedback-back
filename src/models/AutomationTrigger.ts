import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationTriggerTypes = [
  'feedback_submitted',
  'contact_created',
  'contact_updated',
  'contact_added_to_list',
  'contact_entered_segment',
  'rating_below_or_equal',
  'rating_above_or_equal'
] as const;

const automationTriggerSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  type: { type: String, enum: automationTriggerTypes, required: true, index: true },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  enabled: { type: Boolean, default: true, index: true }
}, { timestamps: true });

automationTriggerSchema.index({ company: 1, type: 1, enabled: 1 });
automationTriggerSchema.index({ company: 1, automation: 1 });

export type IAutomationTrigger = InferSchemaType<typeof automationTriggerSchema> & {
  _id: Types.ObjectId;
};

export const AutomationTrigger = mongoose.model<IAutomationTrigger>(
  'AutomationTrigger',
  automationTriggerSchema
);
