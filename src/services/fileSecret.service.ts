import fs from 'fs/promises';
import path from 'path';
import { secretNames, type SecretName } from '../models/EncryptedSecret.js';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/encryption.js';
import { HttpError } from '../utils/httpError.js';

type FileSecretPayload = {
  name: SecretName;
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
  maskedValue: string;
  updatedAt: string;
};

const encryptedSecretsDir = 'storage/secrets';

export function assertSecretName(name: string): asserts name is SecretName {
  if (!secretNames.includes(name as SecretName)) {
    throw new HttpError(400, 'Nom de clé sensible invalide.');
  }
}

function secretsDirectory() {
  return path.resolve(process.cwd(), encryptedSecretsDir);
}

function secretPath(name: SecretName) {
  return path.join(secretsDirectory(), `${name}.secret.json`);
}

export async function writeFileSecret(name: SecretName, value: string) {
  await fs.mkdir(secretsDirectory(), { recursive: true });
  const encrypted = encryptSecret(value);
  const payload: FileSecretPayload = {
    name,
    ...encrypted,
    maskedValue: maskSecret(value),
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(secretPath(name), `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return {
    name,
    maskedValue: payload.maskedValue,
    keyVersion: payload.keyVersion,
    updatedAt: payload.updatedAt
  };
}

export async function readFileSecret(name: SecretName) {
  try {
    const raw = await fs.readFile(secretPath(name), 'utf8');
    const payload = JSON.parse(raw) as FileSecretPayload;
    return decryptSecret(payload);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listFileSecrets() {
  try {
    const files = await fs.readdir(secretsDirectory());
    const secrets = await Promise.all(
      files
        .filter((file) => file.endsWith('.secret.json'))
        .map(async (file) => {
          const raw = await fs.readFile(path.join(secretsDirectory(), file), 'utf8');
          const payload = JSON.parse(raw) as FileSecretPayload;
          return {
            name: payload.name,
            maskedValue: payload.maskedValue,
            keyVersion: payload.keyVersion,
            updatedAt: payload.updatedAt
          };
        })
    );
    return secrets.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
