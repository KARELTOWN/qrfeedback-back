import type { Request, Response } from 'express';
import * as adminService from '../services/admin.service.js';

export async function getStats(req: Request, res: Response) {
  res.json(await adminService.getAdminStats());
}

export async function listUsers(req: Request, res: Response) {
  res.json(await adminService.listUsers({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    search: req.query.search ? String(req.query.search) : undefined
  }));
}

export async function generatePassword(req: Request, res: Response) {
  res.json(await adminService.generateUserPassword(String(req.params.userId)));
}

export async function setUserActive(req: Request, res: Response) {
  res.json(await adminService.setUserActive(String(req.params.userId), Boolean(req.body.isActive)));
}

export async function listQrRequestsWithoutAccount(req: Request, res: Response) {
  const accountFilter = ['all', 'with', 'without'].includes(String(req.query.accountFilter))
    ? String(req.query.accountFilter) as 'all' | 'with' | 'without'
    : 'all';
  res.json(await adminService.listQrRequests({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    accountFilter,
    search: req.query.search ? String(req.query.search) : undefined
  }));
}

export async function getUserDetails(req: Request, res: Response) {
  res.json(await adminService.getUserDetails(String(req.params.userId)));
}

export async function listTransactions(req: Request, res: Response) {
  res.json(await adminService.listTransactions({
    userId: req.query.userId ? String(req.query.userId) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  }));
}

export async function listInactiveUsers(req: Request, res: Response) {
  res.json(await adminService.listInactiveUsers({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  }));
}
