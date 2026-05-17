import type { HydratedDocument } from 'mongoose';
import { EncryptedSecret, secretNames, type SecretName } from '../models/EncryptedSecret.js';
import type { ICompany } from '../models/Company.js';
import type { IUser } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/encryption.js';
import { readFileSecret } from './fileSecret.service.js';

type SaveSecretInput = {
  company: HydratedDocument<ICompany>;
  user: HydratedDocument<IUser>;
  name: SecretName;
  value: string;
};

function assertSecretName(name: string): asserts name is SecretName {
  if (!secretNames.includes(name as SecretName)) {
    throw new HttpError(400, 'Nom de clé sensible invalide.');
  }
}

export async function saveSecret({ company, user, name, value }: SaveSecretInput) {
  assertSecretName(name);
  const encrypted = encryptSecret(value);

  const secret = await EncryptedSecret.findOneAndUpdate(
    { company: company._id, name },
    {
      ...encrypted,
      maskedValue: maskSecret(value),
      createdBy: user._id
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return serializeSecret(secret);
}

export async function listSecrets(company: HydratedDocument<ICompany>) {
  const secrets = await EncryptedSecret.find({ company: company._id }).sort({ name: 1 });
  return secrets.map(serializeSecret);
}

export async function getSecretValue(company: HydratedDocument<ICompany>, name: SecretName) {
  const fileSecret = await readFileSecret(name);
  if (fileSecret) return fileSecret;

  const secret = await EncryptedSecret.findOne({ company: company._id, name });
  if (!secret) return null;

  return decryptSecret({
    ciphertext: secret.ciphertext,
    iv: secret.iv,
    tag: secret.tag,
    keyVersion: secret.keyVersion
  });
}

function serializeSecret(secret: HydratedDocument<import('../models/EncryptedSecret.js').IEncryptedSecret>) {
  return {
    id: secret._id,
    name: secret.name,
    maskedValue: secret.maskedValue,
    keyVersion: secret.keyVersion,
    updatedAt: secret.updatedAt
  };
}
