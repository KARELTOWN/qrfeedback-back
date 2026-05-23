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

export async function getQrCodeListMapping(req: Request, res: Response) {
  const mapping = await qrCodeService.getQrCodeListMapping(req.company, String(req.params.id));
  res.json({ mapping });
}

export async function upsertQrCodeListMapping(req: Request, res: Response) {
  const mapping = await qrCodeService.upsertQrCodeListMapping(req.company, String(req.params.id), {
    listId: req.body.listId,
    fieldMappings: req.body.fieldMappings,
    autoCreateContact: req.body.autoCreateContact,
    autoAddToList: req.body.autoAddToList,
    createdBy: req.user?._id
  });
  res.json({ mapping });
}
