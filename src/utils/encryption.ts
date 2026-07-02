import crypto from 'crypto';
import { env } from '../config/env.js';
import { HttpError } from './httpError.js';

const algorithm = 'aes-256-gcm';
const keyVersion = 'v1';

type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
};

function getMasterKey() {
  if (!env.encryption.masterKey) {
    if (env.nodeEnv === 'production') {
      throw new HttpError(500, 'Clé maître de chiffrement non configurée.');
    }

    return crypto.createHash('sha256').update('qr-feedback-dev-encryption-key').digest();
  }

  const raw = env.encryption.masterKey.trim();
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;

  if (raw.length >= 32) {
    return crypto.createHash('sha256').update(raw).digest();
  }

  throw new HttpError(500, 'ENCRYPTION_MASTER_KEY doit faire 32 octets en base64 ou être une phrase longue.');
}

export function encryptSecret(plainText: string): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv(
    algorithm,
    getMasterKey(),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

export function createMasterKey() {
  return crypto.randomBytes(32).toString('base64');
}

export function maskSecret(value: string) {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
