import crypto from 'crypto';
import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import type { ICompany } from '../models/Company.js';
import { HttpError } from '../utils/httpError.js';
import { getSecretValue } from './secret.service.js';
import { readFileSecret } from './fileSecret.service.js';

type InitializePaymentInput = {
  company: HydratedDocument<ICompany>;
  paymentId: string;
  amount: number;
  description: string;
  customerEmail: string;
  customerName: string;
  metadata: Record<string, string>;
};

type MonerooResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  checkout_url?: string;
};

type MonerooPaymentData = {
  id: string;
  checkout_url?: string;
  status?: string;
  amount?: number;
  currency?: string | { code?: string };
  metadata?: Record<string, string>;
};

async function getMonerooSecretKey(company: HydratedDocument<ICompany>) {
  const encryptedSecret = (await readFileSecret('monerooApiKey')) || await getSecretValue(company, 'monerooApiKey');
  const secret = encryptedSecret || env.moneroo.secretKey;
  if (!secret) {
    throw new HttpError(500, 'Clé API Moneroo non configurée.');
  }
  return secret;
}

function formatMonerooError(message?: string) {
  if (!message) return 'Erreur Moneroo.';

  if (message.toLowerCase().includes('no payment methods enabled for this currency')) {
    return `Aucune méthode de paiement Moneroo n'est activée pour la devise ${env.moneroo.currency}. Activez une méthode compatible dans votre dashboard Moneroo ou changez MONEROO_CURRENCY.`;
  }

  return message;
}

async function monerooRequest<T>(company: HydratedDocument<ICompany>, path: string, init: RequestInit = {}) {
  const secretKey = await getMonerooSecretKey(company);
  const response = await fetch(`${env.moneroo.apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secretKey}`,
      ...(init.headers || {})
    }
  });

  const payload = await response.json().catch(() => null) as MonerooResponse<T> | null;
  if (!response.ok) {
    throw new HttpError(response.status, formatMonerooError(payload?.message));
  }

  return payload;
}

function splitCustomerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || 'Client',
    last_name: parts.slice(1).join(' ') || 'QR Feedback'
  };
}

export async function initializePayment(input: InitializePaymentInput) {
  const customer = splitCustomerName(input.customerName);
  const payload = {
    amount: input.amount,
    currency: env.moneroo.currency,
    description: input.description,
    return_url: `${env.frontendUrl}/paiement/retour?paymentId=${input.paymentId}`,
    customer: {
      email: input.customerEmail,
      ...customer
    },
    metadata: input.metadata
  };

  const result = await monerooRequest<MonerooPaymentData>(input.company, '/v1/payments/initialize', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const data = result?.data;
  const checkoutUrl = data?.checkout_url || result?.checkout_url;
  if (!data?.id || !checkoutUrl) {
    throw new HttpError(502, 'Réponse Moneroo invalide.');
  }

  return {
    providerPaymentId: data.id,
    checkoutUrl
  };
}

export async function retrievePayment(company: HydratedDocument<ICompany>, providerPaymentId: string) {
  const result = await monerooRequest<MonerooPaymentData>(company, `/v1/payments/${providerPaymentId}`, {
    method: 'GET'
  });
  return result?.data;
}

export async function verifyPayment(company: HydratedDocument<ICompany>, providerPaymentId: string) {
  const result = await monerooRequest<MonerooPaymentData>(company, `/v1/payments/${providerPaymentId}/verify`, {
    method: 'GET'
  });
  return result?.data;
}

export async function verifyWebhookSignature(company: HydratedDocument<ICompany>, payload: unknown, signature: string | undefined) {
  if (!signature) return false;

  const secret = await getSecretValue(company, 'monerooWebhookSecret');
  if (!secret) return false;

  const computed = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}
