import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const automationJobTypes = ['run_automation', 'execute_step'] as const;
export const automationJobStatuses = ['queued', 'processing', 'completed', 'failed', 'cancelled'] as const;

const automationJobErrorSchema = new mongoose.Schema({
  message: { type: String },
  code: { type: String },
  stack: { type: String },
  details: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const automationJobSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  execution: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationExecution', required: true, index: true },
  type: { type: String, enum: automationJobTypes, required: true, index: true },
  status: { type: String, enum: automationJobStatuses, default: 'queued', index: true },
  runAt: { type: Date, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 3, min: 1 },
  lockedAt: { type: Date },
  completedAt: { type: Date },
  failedAt: { type: Date },
  lastError: { type: automationJobErrorSchema }
}, { timestamps: true });

automationJobSchema.index({ status: 1, runAt: 1 });
automationJobSchema.index({ company: 1, status: 1, runAt: 1 });
automationJobSchema.index({ execution: 1, status: 1 });

export type IAutomationJob = InferSchemaType<typeof automationJobSchema> & {
  _id: Types.ObjectId;
};

export const AutomationJob = mongoose.model<IAutomationJob>('AutomationJob', automationJobSchema);
