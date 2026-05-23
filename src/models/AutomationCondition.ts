import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationConditionOperators = [
  'exists',
  'not_exists',
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'in',
  'not_in',
  '<',
  '<=',
  '>',
  '>='
] as const;

export const automationConditionJoins = ['and', 'or'] as const;

const automationConditionSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  step: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationStep', index: true },
  field: { type: String, required: true, trim: true },
  operator: { type: String, enum: automationConditionOperators, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
  logicalGroup: { type: String, default: 'root', trim: true },
  join: { type: String, enum: automationConditionJoins, default: 'and' }
}, { timestamps: true });

automationConditionSchema.index({ company: 1, automation: 1 });
automationConditionSchema.index({ company: 1, step: 1 });
automationConditionSchema.index({ automation: 1, logicalGroup: 1 });

export type IAutomationCondition = InferSchemaType<typeof automationConditionSchema> & {
  _id: Types.ObjectId;
};

export const AutomationCondition = mongoose.model<IAutomationCondition>(
  'AutomationCondition',
  automationConditionSchema
);
