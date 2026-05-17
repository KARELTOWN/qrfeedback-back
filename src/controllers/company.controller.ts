import type { Request, Response } from 'express';
import * as companyService from '../services/company.service.js';
import { verifyTurnstileToken } from '../services/turnstile.service.js';

export async function registerCompany(req: Request, res: Response) {
  await verifyTurnstileToken(req.body.turnstileToken, req.ip);
  const company = await companyService.registerCompany(req.body);
  res.status(201).json({
    id: company._id,
    name: company.name,
    slug: company.slug,
    feedbackUrl: company.feedbackUrl,
    qrCodeDataUrl: company.qrCodeDataUrl,
    freeMessagesLimit: company.freeMessagesLimit
  });
}

export async function getPublicCompany(req: Request, res: Response) {
  const company = await companyService.getPublicCompany(String(req.params.slug));
  res.json(company);
}

export async function getPublicProof(req: Request, res: Response) {
  res.json(await companyService.getPublicProof());
}
