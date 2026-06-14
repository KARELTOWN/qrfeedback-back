import type { Request, Response } from 'express';
import * as qrCodeService from '../services/qrcode.service.js';

export async function listQrCodes(req: Request, res: Response) {
  const qrCodes = await qrCodeService.listCompanyQrCodes(req.company, {
    page: Number(req.query.page),
    limit: Number(req.query.limit)
  });
  res.json(qrCodes);
}

export async function createQrCode(req: Request, res: Response) {
  const qrCode = await qrCodeService.createCompanyQrCode({
    company: req.company,
    whatsappNumber: req.body.whatsappNumber,
    label: req.body.label
  });

  res.status(201).json(qrCode);
}

export async function updateQrCodeNotifications(req: Request, res: Response) {
  const qrCode = await qrCodeService.updateCompanyQrCodeNotifications(req.company, String(req.params.qrCodeId), req.body);
  res.json(qrCode);
}
