import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { secretNames, type SecretName } from '../models/EncryptedSecret.js';
import { assertSecretName, writeFileSecret } from '../services/fileSecret.service.js';

const rl = readline.createInterface({ input, output });

try {
  console.log(`Secrets disponibles: ${secretNames.join(', ')}`);
  const nameInput = (await rl.question('Nom du secret à chiffrer: ')).trim();
  assertSecretName(nameInput);

  const value = (await rl.question('Valeur à chiffrer: ')).trim();
  if (value.length < 8) {
    throw new Error('La valeur doit contenir au moins 8 caractères.');
  }

  const secret = await writeFileSecret(nameInput as SecretName, value);
  console.log(`Secret ${secret.name} chiffré: ${secret.maskedValue}`);
} finally {
  rl.close();
}
