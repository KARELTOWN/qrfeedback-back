import type { Request, Response } from "express";
import * as service from "../services/notificationTemplate.service.js";

export async function list(_req: Request, res: Response) { res.json(await service.listNotificationTemplates()); }
export async function get(req: Request, res: Response) { res.json(await service.getNotificationTemplate(String(req.params.name))); }
export async function create(req: Request, res: Response) { res.status(201).json(await service.createNotificationTemplate(req.body)); }
export async function update(req: Request, res: Response) { res.json(await service.updateNotificationTemplate(String(req.params.name), req.body)); }
export async function preview(req: Request, res: Response) { res.json(await service.previewNotificationTemplate(String(req.params.name), req.body.variables || {})); }
