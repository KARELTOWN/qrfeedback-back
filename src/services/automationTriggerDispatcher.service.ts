import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Automation } from '../models/Automation.js';
import { AutomationTrigger, type automationTriggerTypes } from '../models/AutomationTrigger.js';
import {
  buildExecutionDedupeKey,
  createAutomationExecution,
  scheduleAutomationJob
} from './automationExecution.service.js';
import { executeAutomationStep } from './automationStepExecutor.service.js';
import { appLogger } from '../utils/appLogger.js';

export type AutomationTriggerType = typeof automationTriggerTypes[number];

function triggerMatchesConfig(triggerConfig: Record<string, unknown>, context: Record<string, unknown>) {
  if (triggerConfig.form_id && String(triggerConfig.form_id) !== String(context.form_id || context.formId || '')) return false;
  if (triggerConfig.list_id && String(triggerConfig.list_id) !== String(context.list_id || context.listId || '')) return false;
  if (triggerConfig.segment_id && String(triggerConfig.segment_id) !== String(context.segment_id || context.segmentId || '')) return false;
  if (triggerConfig.rating_below_or_equal !== undefined && Number(context.rating) > Number(triggerConfig.rating_below_or_equal)) return false;
  if (triggerConfig.rating_above_or_equal !== undefined && Number(context.rating) < Number(triggerConfig.rating_above_or_equal)) return false;
  return true;
}

export async function dispatchAutomationTrigger(input: {
  company: HydratedDocument<ICompany>;
  type: AutomationTriggerType;
  context: Record<string, unknown>;
}) {
  const triggers = await AutomationTrigger.find({
    company: input.company._id,
    type: input.type,
    enabled: true
  });
  const executions = [];
  appLogger.info('automation:dispatch', 'trigger received', {
    companyId: String(input.company._id),
    type: input.type,
    triggersCount: triggers.length,
    contextKeys: Object.keys(input.context)
  });

  for (const trigger of triggers) {
    const automation = await Automation.findOne({
      _id: trigger.automation,
      company: input.company._id,
      status: 'active',
      archivedAt: { $exists: false }
    });
    if (!automation) {
      appLogger.warn('automation:dispatch', 'trigger skipped: automation not active', { triggerId: String(trigger._id), automationId: String(trigger.automation) });
      continue;
    }
    if (!triggerMatchesConfig((trigger.config || {}) as Record<string, unknown>, input.context)) {
      appLogger.warn('automation:dispatch', 'trigger skipped: config mismatch', { triggerId: String(trigger._id) });
      continue;
    }

    const dedupeKey = buildExecutionDedupeKey({
      automationId: automation._id,
      triggerType: input.type,
      context: input.context,
      entryPolicy: automation.entryPolicy
    });

    try {
      const execution = await createAutomationExecution({
        automation,
        trigger,
        context: input.context,
        dedupeKey
      });
      await scheduleAutomationJob({ execution, type: 'run_automation' });
      executeAutomationStep(String(execution._id)).catch((error) => {
        appLogger.error('automation:dispatch', 'immediate execution failed', {
          executionId: String(execution._id),
          message: error instanceof Error ? error.message : String(error)
        });
      });
      executions.push(execution);
      appLogger.info('automation:dispatch', 'execution created', {
        executionId: String(execution._id),
        automationId: String(automation._id)
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('duplicate key')) throw error;
      appLogger.warn('automation:dispatch', 'duplicate execution skipped', { dedupeKey });
    }
  }

  return { executionsCount: executions.length, executions };
}
