import type { HydratedDocument, Types } from 'mongoose';
import { Automation, type IAutomation } from '../models/Automation.js';
import { AutomationExecution, type IAutomationExecution } from '../models/AutomationExecution.js';
import { AutomationExecutionLog } from '../models/AutomationExecutionLog.js';
import { AutomationJob } from '../models/AutomationJob.js';
import type { IAutomationTrigger } from '../models/AutomationTrigger.js';

type CreateExecutionInput = {
  automation: HydratedDocument<IAutomation>;
  trigger?: HydratedDocument<IAutomationTrigger>;
  context: Record<string, unknown>;
  dedupeKey?: string;
};

type ExecutionError = {
  message?: string;
  code?: string;
  stack?: string;
  details?: unknown;
};

function serializeError(error: unknown): ExecutionError {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

export async function createAutomationExecution({ automation, trigger, context, dedupeKey }: CreateExecutionInput) {
  const execution = await AutomationExecution.create({
    company: automation.company,
    automation: automation._id,
    trigger: trigger?._id,
    status: 'queued',
    context,
    dedupeKey
  });

  await logAutomationExecution(execution, {
    event: 'trigger_received',
    message: 'Automation trigger received.',
    data: { triggerType: trigger?.type }
  });

  return execution;
}

export async function startAutomationExecution(execution: HydratedDocument<IAutomationExecution>) {
  if (execution.status === 'completed' || execution.status === 'cancelled') return execution;
  execution.status = 'running';
  execution.startedAt = execution.startedAt || new Date();
  await execution.save();
  await logAutomationExecution(execution, { event: 'execution_started', message: 'Automation execution started.' });
  return execution;
}

export async function completeAutomationExecution(execution: HydratedDocument<IAutomationExecution>) {
  execution.status = 'completed';
  execution.completedAt = new Date();
  await execution.save();
  await logAutomationExecution(execution, { event: 'execution_completed', message: 'Automation execution completed.' });
  return execution;
}

export async function failAutomationExecution(execution: HydratedDocument<IAutomationExecution>, error: unknown) {
  execution.status = 'failed';
  execution.failedAt = new Date();
  execution.lastError = serializeError(error);
  await execution.save();
  const lastError = serializeError(error);
  await logAutomationExecution(execution, {
    level: 'error',
    event: 'execution_failed',
    message: lastError.message || 'Automation execution failed.',
    error: lastError
  });
  return execution;
}

export async function scheduleAutomationJob(input: {
  execution: HydratedDocument<IAutomationExecution>;
  type: 'run_automation' | 'execute_step';
  runAt?: Date;
  payload?: Record<string, unknown>;
}) {
  return AutomationJob.create({
    company: input.execution.company,
    automation: input.execution.automation,
    execution: input.execution._id,
    type: input.type,
    runAt: input.runAt || new Date(),
    payload: input.payload || {}
  });
}

export async function findAutomationForExecution(execution: HydratedDocument<IAutomationExecution>) {
  return Automation.findOne({
    _id: execution.automation,
    company: execution.company,
    archivedAt: { $exists: false }
  });
}

export async function logAutomationExecution(
  execution: HydratedDocument<IAutomationExecution>,
  input: {
    level?: 'debug' | 'info' | 'warning' | 'error';
    event: string;
    message?: string;
    stepKey?: string;
    data?: Record<string, unknown>;
    error?: ExecutionError;
  }
) {
  return AutomationExecutionLog.create({
    company: execution.company,
    automation: execution.automation,
    execution: execution._id,
    stepKey: input.stepKey,
    level: input.level || 'info',
    event: input.event,
    message: input.message,
    data: input.data || {},
    error: input.error
  });
}

export function buildExecutionDedupeKey(input: {
  automationId: Types.ObjectId | string;
  triggerType: string;
  context: Record<string, unknown>;
  entryPolicy: string;
}) {
  if (input.entryPolicy === 'allow_multiple') return undefined;
  const contactId = input.context.contact_id || input.context.contactId || 'no_contact';
  if (input.entryPolicy === 'once_per_contact') return `${input.automationId}:${contactId}`;
  const feedbackId = input.context.feedback_id || input.context.feedbackId || 'no_feedback';
  return `${input.automationId}:${input.triggerType}:${contactId}:${feedbackId}`;
}
