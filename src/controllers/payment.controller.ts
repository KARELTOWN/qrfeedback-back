import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import * as paymentService from '../services/payment.service.js';
import { readFileSecret } from '../services/fileSecret.service.js';

export async function createPayment(req: Request, res: Response) {
  const payment = await paymentService.createPayment(req.body);
  res.status(201).json(payment);
}

export async function createAuthenticatedPayment(req: Request, res: Response) {
  const payment = await paymentService.createPaymentForCompany(req.company, req.body.planCode);
  res.status(201).json(payment);
}

export async function confirmPayment(req: Request, res: Response) {
  const paymentConfirmSecret = (await readFileSecret('paymentConfirmSecret')) || env.paymentConfirmSecret;
  if (!paymentConfirmSecret || req.headers['x-payment-secret'] !== paymentConfirmSecret) {
    throw new HttpError(401, 'Confirmation de paiement non autorisée.');
  }

  const payment = await paymentService.confirmPayment(String(req.params.id));
  res.json({ ok: true, payment });
}

export async function verifyPaymentReturn(req: Request, res: Response) {
  const payment = await paymentService.confirmPaymentReference(String(req.params.id));
  res.json({ ok: true, payment });
}

export async function monerooWebhook(req: Request, res: Response) {
  await paymentService.processMonerooWebhook(req.body, req.headers['x-moneroo-signature'] as string | undefined);
  res.sendStatus(200);
}
