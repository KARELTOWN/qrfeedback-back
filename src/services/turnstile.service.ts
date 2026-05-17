import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

type TurnstileResponse = {
  success: boolean;
  'error-codes'?: string[];
};

export async function verifyTurnstileToken(token: unknown, remoteIp?: string) {
  if (!env.turnstile.secretKey) {
    if (env.nodeEnv === 'production') {
      throw new HttpError(500, 'Turnstile non configure.');
    }
    return;
  }

  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    throw new HttpError(400, 'Verification anti-robot requise.');
  }

  const form = new URLSearchParams({
    secret: env.turnstile.secretKey,
    response: token
  });

  if (remoteIp) form.set('remoteip', remoteIp);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new HttpError(502, 'Verification anti-robot indisponible.');
  }

  const result = (await response.json()) as TurnstileResponse;
  if (!result.success) {
    throw new HttpError(400, 'Verification anti-robot invalide.');
  }
}
