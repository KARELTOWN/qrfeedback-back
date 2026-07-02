import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export function generateStrongPassword() {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&?'
  ];
  const allCharacters = groups.join('');
  const length = crypto.randomInt(8, 11);
  const password = [
    ...groups.map((group) => group[crypto.randomInt(group.length)]),
    ...Array.from({ length: length - groups.length }, () => allCharacters[crypto.randomInt(allCharacters.length)])
  ];

  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }

  return password.join('');
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
