import type { Request, Response } from 'express';
import * as automationService from '../services/automation.service.js';

export async function listAutomations(req: Request, res: Response) {
  const automations = await automationService.listAutomations(req.company);
  res.json({ automations });
}

export async function createAutomation(req: Request, res: Response) {
  const automation = await automationService.createAutomation(req.company, req.body, req.user?._id);
  res.status(201).json(automation);
}

export async function getAutomation(req: Request, res: Response) {
  const automation = await automationService.getAutomation(req.company, String(req.params.id));
  res.json(automation);
}

export async function updateAutomation(req: Request, res: Response) {
  const automation = await automationService.updateAutomation(req.company, String(req.params.id), req.body, req.user?._id);
  res.json(automation);
}

export async function publishAutomation(req: Request, res: Response) {
  const automation = await automationService.publishAutomation(req.company, String(req.params.id));
  res.json(automation);
}

export async function pauseAutomation(req: Request, res: Response) {
  const automation = await automationService.pauseAutomation(req.company, String(req.params.id));
  res.json(automation);
}

export async function deleteAutomation(req: Request, res: Response) {
  const automation = await automationService.archiveAutomation(req.company, String(req.params.id));
  res.json({ ok: true, automation });
}

export async function listExecutions(req: Request, res: Response) {
  const executions = await automationService.listAutomationExecutions(req.company, String(req.params.id));
  res.json({ executions });
}

export async function listLogs(req: Request, res: Response) {
  const logs = await automationService.listAutomationExecutionLogs(req.company, String(req.params.id));
  res.json({ logs });
}

export async function testAutomation(req: Request, res: Response) {
  const result = await automationService.testAutomation(req.company, String(req.params.id), req.body?.context || {});
  res.json(result);
}
