import type { HydratedDocument } from 'mongoose';
import { AutomationCondition } from '../models/AutomationCondition.js';
import { AutomationExecution, type IAutomationExecution } from '../models/AutomationExecution.js';
import { AutomationStep, type IAutomationStep } from '../models/AutomationStep.js';
import { evaluateConditions, type AutomationConditionInput } from './conditionEvaluator.service.js';
import {
  completeAutomationExecution,
  failAutomationExecution,
  logAutomationExecution,
  scheduleAutomationJob,
  startAutomationExecution
} from './automationExecution.service.js';
import { executeAutomationAction } from './automationActionExecutor.service.js';
import { appLogger } from '../utils/appLogger.js';

function delayMs(config: Record<string, unknown>) {
  const amount = Number(config.amount || config.value || 0);
  const unit = String(config.unit || 'minutes');
  const multiplier = unit === 'days' ? 24 * 60 * 60 * 1000 : unit === 'hours' ? 60 * 60 * 1000 : 60 * 1000;
  return Math.max(0, amount * multiplier);
}

async function firstStep(execution: HydratedDocument<IAutomationExecution>) {
  return AutomationStep.findOne({
    company: execution.company,
    automation: execution.automation,
    enabled: true
  }).sort({ position: 1 });
}

async function stepByKey(execution: HydratedDocument<IAutomationExecution>, stepKey?: string) {
  if (!stepKey) return firstStep(execution);
  return AutomationStep.findOne({
    company: execution.company,
    automation: execution.automation,
    key: stepKey,
    enabled: true
  });
}

async function conditionInputs(step: HydratedDocument<IAutomationStep>) {
  const explicitConditions = await AutomationCondition.find({
    company: step.company,
    automation: step.automation,
    step: step._id
  }).lean();
  if (explicitConditions.length) {
    return explicitConditions.map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value: condition.value
    }));
  }

  const config = (step.config || {}) as Record<string, unknown>;
  return Array.isArray(config.conditions)
    ? config.conditions as AutomationConditionInput[]
    : config.field && config.operator
      ? [{ field: String(config.field), operator: String(config.operator), value: config.value }]
      : [];
}

async function enqueueNextStep(execution: HydratedDocument<IAutomationExecution>, nextStepKey?: string) {
  if (!nextStepKey) {
    await completeAutomationExecution(execution);
    return;
  }

  execution.currentStepKey = nextStepKey;
  execution.status = 'running';
  execution.waitingUntil = undefined;
  await execution.save();
  await scheduleAutomationJob({
    execution,
    type: 'execute_step',
    payload: { stepKey: nextStepKey }
  });
}

async function executeConditionStep(execution: HydratedDocument<IAutomationExecution>, step: HydratedDocument<IAutomationStep>) {
  const config = (step.config || {}) as Record<string, unknown>;
  const conditions = await conditionInputs(step);
  const join = config.join === 'or' ? 'or' : 'and';
  const passed = evaluateConditions(execution.context as Record<string, unknown>, conditions, join);
  await logAutomationExecution(execution, {
    event: 'condition_evaluated',
    stepKey: step.key,
    message: passed ? 'Condition passed.' : 'Condition failed.',
    data: { passed, conditionsCount: conditions.length }
  });
  const nextStepKey = passed ? step.trueStepKey || step.nextStepKey : step.falseStepKey || step.nextStepKey;
  await enqueueNextStep(execution, nextStepKey || undefined);
}

async function executeDelayStep(execution: HydratedDocument<IAutomationExecution>, step: HydratedDocument<IAutomationStep>) {
  const runAt = new Date(Date.now() + delayMs((step.config || {}) as Record<string, unknown>));
  execution.status = 'waiting';
  execution.currentStepKey = step.nextStepKey;
  execution.waitingUntil = runAt;
  await execution.save();
  await scheduleAutomationJob({
    execution,
    type: 'execute_step',
    runAt,
    payload: { stepKey: step.nextStepKey || undefined }
  });
  await logAutomationExecution(execution, {
    event: 'delay_scheduled',
    stepKey: step.key,
    message: 'Delay scheduled.',
    data: { runAt }
  });
}

async function executeActionStep(execution: HydratedDocument<IAutomationExecution>, step: HydratedDocument<IAutomationStep>) {
  await logAutomationExecution(execution, {
    event: 'action_queued',
    stepKey: step.key,
    message: 'Action execution queued.',
    data: { actionType: step.actionType, config: step.config || {} }
  });
  const result = await executeAutomationAction(execution, step);
  await logAutomationExecution(execution, {
    event: 'action_completed',
    stepKey: step.key,
    message: result.skipped ? 'Action skipped.' : 'Action completed.',
    data: result
  });
  await enqueueNextStep(execution, step.nextStepKey || undefined);
}

export async function executeAutomationStep(executionId: string, stepKey?: string) {
  const execution = await AutomationExecution.findById(executionId);
  if (!execution || execution.status === 'completed' || execution.status === 'cancelled') {
    appLogger.warn('automation:step', 'execution ignored', { executionId, status: execution?.status });
    return;
  }

  try {
    await startAutomationExecution(execution);
    const step = await stepByKey(execution, stepKey || execution.currentStepKey || undefined);
    if (!step) {
      await completeAutomationExecution(execution);
      return;
    }

    execution.currentStepKey = step.key;
    await execution.save();
    await logAutomationExecution(execution, { event: 'step_started', stepKey: step.key, message: 'Step started.' });
    appLogger.info('automation:step', 'started', {
      executionId: String(execution._id),
      stepKey: step.key,
      type: step.type,
      actionType: step.actionType
    });

    if (step.type === 'condition') await executeConditionStep(execution, step);
    else if (step.type === 'delay') await executeDelayStep(execution, step);
    else await executeActionStep(execution, step);
  } catch (error) {
    appLogger.error('automation:step', 'failed', { executionId, message: error instanceof Error ? error.message : String(error) });
    await failAutomationExecution(execution, error);
  }
}
