import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationStepTypes = ['condition', 'delay', 'action'] as const;

export const automationActionTypes = [
  'send_whatsapp_message',
  'add_tag',
  'remove_tag',
  'add_to_list',
  'remove_from_list',
  'notify_manager',
  'create_internal_alert',
  'create_inbox_conversation',
  'create_ticket',
  'update_contact_field'
] as const;

export const automationDelayUnits = ['minutes', 'hours', 'days'] as const;

const automationStepSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  key: { type: String, required: true, trim: true },
  type: { type: String, enum: automationStepTypes, required: true, index: true },
  actionType: { type: String, enum: automationActionTypes },
  name: { type: String, trim: true },
  position: { type: Number, default: 0 },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  nextStepKey: { type: String, trim: true },
  trueStepKey: { type: String, trim: true },
  falseStepKey: { type: String, trim: true },
  enabled: { type: Boolean, default: true, index: true }
}, { timestamps: true });

automationStepSchema.index({ automation: 1, key: 1 }, { unique: true });
automationStepSchema.index({ company: 1, automation: 1, position: 1 });
automationStepSchema.index({ company: 1, type: 1, enabled: 1 });

export type IAutomationStep = InferSchemaType<typeof automationStepSchema> & {
  _id: Types.ObjectId;
};

export const AutomationStep = mongoose.model<IAutomationStep>('AutomationStep', automationStepSchema);
