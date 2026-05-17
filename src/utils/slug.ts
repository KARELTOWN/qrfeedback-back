import crypto from 'crypto';

export function createSlug(name: string) {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  return `${normalized || 'entreprise'}-${crypto.randomBytes(4).toString('hex')}`;
}
