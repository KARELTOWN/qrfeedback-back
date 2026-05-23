import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationExecutionLogLevels = ['debug', 'info', 'warning', 'error'] as const;

export const automationExecutionLogEvents = [
  'trigger_received',
  'execution_started',
  'step_started',
  'condition_evaluated',
  'delay_scheduled',
  'action_queued',
  'action_completed',
  'step_failed',
  'execution_completed',
  'execution_failed',
  'execution_cancelled'
] as const;

const automationExecutionLogErrorSchema = new mongoose.Schema({
  message: { type: String },
  code: { type: String },
  stack: { type: String },
  details: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const automationExecutionLogSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  execution: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationExecution', required: true, index: true },
  stepKey: { type: String, trim: true },
  level: { type: String, enum: automationExecutionLogLevels, default: 'info', index: true },
  event: { type: String, enum: automationExecutionLogEvents, required: true, index: true },
  message: { type: String, trim: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  error: { type: automationExecutionLogErrorSchema }
}, { timestamps: true });

automationExecutionLogSchema.index({ execution: 1, createdAt: 1 });
automationExecutionLogSchema.index({ company: 1, level: 1, createdAt: -1 });
automationExecutionLogSchema.index({ company: 1, event: 1, createdAt: -1 });

export type IAutomationExecutionLog = InferSchemaType<typeof automationExecutionLogSchema> & {
  _id: Types.ObjectId;
};

export const AutomationExecutionLog = mongoose.model<IAutomationExecutionLog>(
  'AutomationExecutionLog',
  automationExecutionLogSchema
);
