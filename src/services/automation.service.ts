import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Automation } from '../models/Automation.js';
import { AutomationExecution } from '../models/AutomationExecution.js';
import { AutomationExecutionLog } from '../models/AutomationExecutionLog.js';
import { AutomationStep } from '../models/AutomationStep.js';
import { AutomationTrigger } from '../models/AutomationTrigger.js';
import { HttpError } from '../utils/httpError.js';
import { createAutomationExecution } from './automationExecution.service.js';
import { executeAutomationStep } from './automationStepExecutor.service.js';

type AutomationPayload = {
  name?: string;
  description?: string;
  status?: string;
  entryPolicy?: string;
  timezone?: string;
  metadata?: Record<string, unknown>;
  triggers?: Array<{
    type: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }>;
  steps?: Array<{
    key: string;
    type: string;
    actionType?: string;
    name?: string;
    position?: number;
    config?: Record<string, unknown>;
    nextStepKey?: string;
    trueStepKey?: string;
    falseStepKey?: string;
    enabled?: boolean;
  }>;
};

function baseAutomationQuery(company: HydratedDocument<ICompany>) {
  return { company: company._id, archivedAt: { $exists: false } };
}

function cleanText(value?: string) {
  const text = String(value || '').trim();
  return text || undefined;
}

function objectId(value?: Types.ObjectId | string) {
  if (!value) return undefined;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : undefined;
}

async function replaceAutomationGraph(company: HydratedDocument<ICompany>, automationId: unknown, payload: AutomationPayload) {
  if (payload.triggers) {
    await AutomationTrigger.deleteMany({ company: company._id, automation: automationId });
    if (payload.triggers.length) {
      await AutomationTrigger.insertMany(payload.triggers.map((trigger) => ({
        company: company._id,
        automation: automationId,
        type: trigger.type,
        config: trigger.config || {},
        enabled: trigger.enabled !== false
      })));
    }
  }

  if (payload.steps) {
    await AutomationStep.deleteMany({ company: company._id, automation: automationId });
    if (payload.steps.length) {
      await AutomationStep.insertMany(payload.steps.map((step, index) => ({
        company: company._id,
        automation: automationId,
        key: step.key,
        type: step.type,
        actionType: step.actionType,
        name: step.name,
        position: typeof step.position === 'number' ? step.position : index,
        config: step.config || {},
        nextStepKey: cleanText(step.nextStepKey),
        trueStepKey: cleanText(step.trueStepKey),
        falseStepKey: cleanText(step.falseStepKey),
        enabled: step.enabled !== false
      })));
    }
  }
}

async function serializeAutomation(company: HydratedDocument<ICompany>, automationId: unknown) {
  const [automation, triggers, steps] = await Promise.all([
    Automation.findOne({ _id: automationId, ...baseAutomationQuery(company) }),
    AutomationTrigger.find({ company: company._id, automation: automationId }).sort({ createdAt: 1 }),
    AutomationStep.find({ company: company._id, automation: automationId }).sort({ position: 1 })
  ]);
  if (!automation) throw new HttpError(404, 'Automation introuvable.');
  return { automation, triggers, steps };
}

export async function listAutomations(company: HydratedDocument<ICompany>) {
  return Automation.find(baseAutomationQuery(company)).sort({ updatedAt: -1 });
}

export async function getAutomation(company: HydratedDocument<ICompany>, automationId: string) {
  return serializeAutomation(company, automationId);
}

export async function createAutomation(company: HydratedDocument<ICompany>, payload: AutomationPayload, userId?: Types.ObjectId | string) {
  const name = cleanText(payload.name);
  if (!name) throw new HttpError(400, 'Nom automation requis.');

  const automation = await Automation.create({
    company: company._id,
    name,
    description: cleanText(payload.description),
    status: payload.status === 'active' || payload.status === 'paused' ? payload.status : 'draft',
    entryPolicy: payload.entryPolicy || 'allow_multiple',
    timezone: cleanText(payload.timezone) || 'Africa/Lagos',
    metadata: payload.metadata || {},
    createdBy: objectId(userId),
    updatedBy: objectId(userId)
  });

  await replaceAutomationGraph(company, automation._id, payload);
  return serializeAutomation(company, automation._id);
}

export async function updateAutomation(company: HydratedDocument<ICompany>, automationId: string, payload: AutomationPayload, userId?: Types.ObjectId | string) {
  const automation = await Automation.findOne({ _id: automationId, ...baseAutomationQuery(company) });
  if (!automation) throw new HttpError(404, 'Automation introuvable.');

  if (payload.name !== undefined) automation.name = cleanText(payload.name) || automation.name;
  if (payload.description !== undefined) automation.description = cleanText(payload.description);
  if (payload.status && ['draft', 'active', 'paused'].includes(payload.status)) automation.status = payload.status as 'draft' | 'active' | 'paused';
  if (payload.entryPolicy) automation.entryPolicy = payload.entryPolicy as 'allow_multiple' | 'once_per_contact' | 'once_per_contact_per_trigger';
  if (payload.timezone !== undefined) automation.timezone = cleanText(payload.timezone) || automation.timezone;
  if (payload.metadata !== undefined) automation.metadata = payload.metadata;
  automation.version += 1;
  automation.updatedBy = objectId(userId);
  await automation.save();

  await replaceAutomationGraph(company, automation._id, payload);
  return serializeAutomation(company, automation._id);
}

export async function publishAutomation(company: HydratedDocument<ICompany>, automationId: string) {
  const automation = await Automation.findOne({ _id: automationId, ...baseAutomationQuery(company) });
  if (!automation) throw new HttpError(404, 'Automation introuvable.');

  const [triggersCount, stepsCount] = await Promise.all([
    AutomationTrigger.countDocuments({ company: company._id, automation: automation._id, enabled: true }),
    AutomationStep.countDocuments({ company: company._id, automation: automation._id, enabled: true })
  ]);
  if (!triggersCount) throw new HttpError(400, 'Ajoutez au moins un declencheur actif.');
  if (!stepsCount) throw new HttpError(400, 'Ajoutez au moins une etape active.');

  automation.status = 'active';
  automation.publishedAt = new Date();
  await automation.save();
  return serializeAutomation(company, automation._id);
}

export async function pauseAutomation(company: HydratedDocument<ICompany>, automationId: string) {
  const automation = await Automation.findOne({ _id: automationId, ...baseAutomationQuery(company) });
  if (!automation) throw new HttpError(404, 'Automation introuvable.');
  automation.status = 'paused';
  await automation.save();
  return serializeAutomation(company, automation._id);
}

export async function archiveAutomation(company: HydratedDocument<ICompany>, automationId: string) {
  const automation = await Automation.findOne({ _id: automationId, ...baseAutomationQuery(company) });
  if (!automation) throw new HttpError(404, 'Automation introuvable.');
  automation.status = 'archived';
  automation.archivedAt = new Date();
  await automation.save();
  return automation;
}

export async function listAutomationExecutions(company: HydratedDocument<ICompany>, automationId: string) {
  return AutomationExecution.find({
    company: company._id,
    automation: automationId
  }).sort({ createdAt: -1 }).limit(50);
}

export async function listAutomationExecutionLogs(company: HydratedDocument<ICompany>, executionId: string) {
  const execution = await AutomationExecution.findOne({ _id: executionId, company: company._id });
  if (!execution) throw new HttpError(404, 'Execution introuvable.');
  return AutomationExecutionLog.find({ company: company._id, execution: execution._id }).sort({ createdAt: 1 });
}

export async function testAutomation(company: HydratedDocument<ICompany>, automationId: string, context: Record<string, unknown> = {}) {
  const automation = await Automation.findOne({ _id: automationId, ...baseAutomationQuery(company) });
  if (!automation) throw new HttpError(404, 'Automation introuvable.');

  const defaultContext = {
    company_id: String(company._id),
    rating: 5,
    feedback: {
      rating: 5,
      serviceFeedback: 'Message de test automation'
    },
    contact: {
      firstName: 'Client',
      lastName: 'Test',
      whatsapp: context.to || context.whatsapp || ''
    },
    custom_fields: {}
  };

  const execution = await createAutomationExecution({
    automation,
    context: {
      ...defaultContext,
      ...context,
      contact: {
        ...(defaultContext.contact as Record<string, unknown>),
        ...(context.contact && typeof context.contact === 'object' ? context.contact as Record<string, unknown> : {})
      }
    }
  });

  await executeAutomationStep(String(execution._id));
  const logs = await AutomationExecutionLog.find({ execution: execution._id }).sort({ createdAt: 1 });
  const refreshed = await AutomationExecution.findById(execution._id);
  return { execution: refreshed || execution, logs };
}
