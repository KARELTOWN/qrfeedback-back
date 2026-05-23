import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationExecutionStatuses = [
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled'
] as const;

const automationExecutionErrorSchema = new mongoose.Schema({
  message: { type: String },
  code: { type: String },
  stack: { type: String },
  details: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const automationExecutionSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  trigger: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationTrigger', index: true },
  status: { type: String, enum: automationExecutionStatuses, default: 'queued', index: true },
  currentStepKey: { type: String, trim: true },
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
  dedupeKey: { type: String, trim: true, index: true },
  startedAt: { type: Date },
  waitingUntil: { type: Date, index: true },
  completedAt: { type: Date },
  failedAt: { type: Date },
  cancelledAt: { type: Date },
  lastError: { type: automationExecutionErrorSchema }
}, { timestamps: true });

automationExecutionSchema.index({ company: 1, status: 1, createdAt: -1 });
automationExecutionSchema.index({ automation: 1, status: 1 });
automationExecutionSchema.index({ company: 1, waitingUntil: 1 });
automationExecutionSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

export type IAutomationExecution = InferSchemaType<typeof automationExecutionSchema> & {
  _id: Types.ObjectId;
};

export const AutomationExecution = mongoose.model<IAutomationExecution>(
  'AutomationExecution',
  automationExecutionSchema
);
