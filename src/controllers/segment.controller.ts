import type { Request, Response } from 'express';
import * as segmentService from '../services/segment.service.js';

export async function listSegments(req: Request, res: Response) {
  res.json(await segmentService.listSegments(req.company, {
    page: Number(req.query.page),
    limit: Number(req.query.limit)
  }));
}

export async function listTemplates(req: Request, res: Response) {
  res.json({ templates: segmentService.segmentTemplates });
}

export async function filterContacts(req: Request, res: Response) {
  res.json(await segmentService.filterContactsForSegment(req.company, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    search: String(req.query.search || ''),
    conditions: req.body.conditions || [],
    matchType: req.body.matchType || 'all'
  }));
}

export async function previewSegment(req: Request, res: Response) {
  res.json(await segmentService.previewSegment(req.company, {
    search: req.body.search,
    conditions: req.body.conditions || [],
    matchType: req.body.matchType || 'all'
  }));
}

export async function createSegment(req: Request, res: Response) {
  const segment = await segmentService.createSegment({
    company: req.company,
    name: req.body.name,
    description: req.body.description,
    type: req.body.type,
    matchType: req.body.matchType,
    conditions: req.body.conditions,
    contactIds: req.body.contactIds,
    createdBy: req.user?._id
  });
  res.status(201).json({ segment });
}

export async function getSegment(req: Request, res: Response) {
  const segment = await segmentService.getSegment(req.company, String(req.params.id));
  res.json({ segment });
}

export async function updateSegment(req: Request, res: Response) {
  const segment = await segmentService.updateSegment(req.company, String(req.params.id), req.body);
  res.json({ segment });
}

export async function archiveSegment(req: Request, res: Response) {
  const segment = await segmentService.archiveSegment(req.company, String(req.params.id));
  res.json({ segment });
}

export async function recalculateSegment(req: Request, res: Response) {
  const segment = await segmentService.recalculateSegment(req.company, String(req.params.id));
  res.json({ segment });
}

export async function listSegmentMembers(req: Request, res: Response) {
  res.json(await segmentService.listSegmentMembers(req.company, String(req.params.id), {
    page: Number(req.query.page),
    limit: Number(req.query.limit)
  }));
}
