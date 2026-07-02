import type { Request, Response } from 'express';
import { HttpError } from '../utils/httpError.js';

function paymentDisabled(): never {
  throw new HttpError(410, 'Les paiements sont desactives: QrFeedback est gratuit.');
}

export async function createPayment(req: Request, res: Response) {
  paymentDisabled();
}

export async function createAuthenticatedPayment(req: Request, res: Response) {
  paymentDisabled();
}

export async function confirmPayment(req: Request, res: Response) {
  paymentDisabled();
}

export async function verifyPaymentReturn(req: Request, res: Response) {
  paymentDisabled();
}
