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
    label: req.body.label
  });

  res.status(201).json(qrCode);
}

export async function updateQrCodeNotifications(req: Request, res: Response) {
  const qrCode = await qrCodeService.updateCompanyQrCodeNotifications(req.company, String(req.params.qrCodeId), req.body);
  res.json(qrCode);
}

export async function updateQrCode(req: Request, res: Response) {
  const qrCode = await qrCodeService.updateCompanyQrCode(req.company, String(req.params.qrCodeId), req.body);
  res.json(qrCode);
}

export async function disableQrCode(req: Request, res: Response) {
  const qrCode = await qrCodeService.disableCompanyQrCode(req.company, String(req.params.qrCodeId));
  res.json(qrCode);
}

export async function downloadQrCodePng(req: Request, res: Response) {
  const qrCode = await qrCodeService.getCompanyQrCode(req.company, String(req.params.qrCodeId));
  const base64 = qrCode.qrCodeDataUrl.split(',')[1] || qrCode.qrCodeDataUrl;
  res.header('Content-Type', 'image/png');
  res.attachment(`qr-code-${qrCode.slug}.png`);
  res.send(Buffer.from(base64, 'base64'));
}

export async function downloadQrCodePdf(req: Request, res: Response) {
  const { qrCode, pdf } = await qrCodeService.buildCompanyQrCodePdf(req.company, String(req.params.qrCodeId));
  res.header('Content-Type', 'application/pdf');
  res.attachment(`qr-code-${qrCode.slug}.pdf`);
  res.send(pdf);
}
