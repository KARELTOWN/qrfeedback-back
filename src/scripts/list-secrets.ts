import { listFileSecrets } from '../services/fileSecret.service.js';

const secrets = await listFileSecrets();

if (!secrets.length) {
  console.log('Aucun secret chiffré localement.');
} else {
  for (const secret of secrets) {
    console.log(`${secret.name}: ${secret.maskedValue} (${secret.updatedAt})`);
  }
}
