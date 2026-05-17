import type { Request, Response } from 'express';
import type { SecretName } from '../models/EncryptedSecret.js';
import * as secretService from '../services/secret.service.js';

export async function listSecrets(req: Request, res: Response) {
  const secrets = await secretService.listSecrets(req.company);
  res.json(secrets);
}

export async function upsertSecret(req: Request, res: Response) {
  const secret = await secretService.saveSecret({
    company: req.company,
    user: req.user,
    name: req.params.name as SecretName,
    value: req.body.value
  });

  res.json(secret);
}
