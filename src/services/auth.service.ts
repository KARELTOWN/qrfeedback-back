import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { User, type IUser } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { createSlug } from '../utils/slug.js';
import { generateStrongPassword, hashPassword, hashToken, verifyPassword } from '../utils/password.js';
import { generateQrDataUrl } from './qr.service.js';
import { sendTemplateMail } from './notificationTemplate.service.js';
import { readFileSecret } from './fileSecret.service.js';
import { getJwtSecret } from './jwtSecret.service.js';

type SignupInput = {
  companyName?: string;
  email: string;
  password: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type TelegramAuthInput = {
  initData: string;
  email?: string;
  companyName?: string;
};

type TelegramIdentity = {
  id: string;
  username?: string;
  firstName: string;
  lastName?: string;
};

type ChangePasswordInput = {
  user: HydratedDocument<IUser>;
  currentPassword: string;
  newPassword: string;
};

type ResetPasswordInput = {
  email: string;
  code: string;
  password: string;
};

type OtpPurpose = 'signup' | 'login' | 'reset-password';

type VerifyOtpInput = {
  email: string;
  code: string;
  purpose: OtpPurpose;
};

/**
 * Verifies the signed payload supplied by Telegram.WebApp.initData.
 * The browser payload is untrusted until this check succeeds.
 */
export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
): TelegramIdentity {
  const values = new URLSearchParams(initData);
  const hashes = values.getAll('hash');
  if (hashes.length !== 1 || !hashes[0]) {
    throw new HttpError(401, 'Donnees Telegram incompletes.');
  }

  const dataCheckString = [...values.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const receivedHash = hashes[0];
  if (receivedHash.length !== calculatedHash.length || !crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(calculatedHash))) {
    throw new HttpError(401, 'Signature Telegram invalide.');
  }

  const authDate = Number(values.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > now + 300 || now - authDate > maxAgeSeconds) {
    throw new HttpError(401, 'Session Telegram expiree. Reouvrez l’application Telegram.');
  }

  const rawUser = values.get('user');
  if (!rawUser) throw new HttpError(401, 'Profil Telegram manquant.');

  let user: unknown;
  try {
    user = JSON.parse(rawUser);
  } catch {
    throw new HttpError(401, 'Profil Telegram invalide.');
  }

  if (!user || typeof user !== 'object' || !('id' in user) || !('first_name' in user)) {
    throw new HttpError(401, 'Profil Telegram invalide.');
  }

  const telegramUser = user as { id: number | string; first_name: unknown; last_name?: unknown; username?: unknown };
  if (!/^[0-9]+$/.test(String(telegramUser.id)) || typeof telegramUser.first_name !== 'string' || !telegramUser.first_name.trim()) {
    throw new HttpError(401, 'Profil Telegram invalide.');
  }

  return {
    id: String(telegramUser.id),
    firstName: telegramUser.first_name.trim(),
    username: typeof telegramUser.username === 'string' ? telegramUser.username : undefined,
    lastName: typeof telegramUser.last_name === 'string' ? telegramUser.last_name : undefined,
  };
}

async function getTelegramBotToken() {
  return env.telegram.botToken || await readFileSecret('telegramBotToken');
}

async function sign(user: HydratedDocument<IUser>) {
  return jwt.sign({ sub: user._id, tokenVersion: user.tokenVersion || 0 }, await getJwtSecret(), { expiresIn: '7d' });
}

async function serializeAuth(user: HydratedDocument<IUser>) {
  return {
    token: await sign(user),
    user: {
      email: user.email,
      roleId: user.roleId || 'utilisateur',
      isActive: user.isActive !== false,
      mustChangePassword: user.mustChangePassword,
      company: user.company
    }
  };
}

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

function companyNameFromEmail(email: string) {
  const localPart = email.split('@')[0] || 'Entreprise';
  return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function sendOtp(user: HydratedDocument<IUser>, purpose: OtpPurpose) {
  const code = generateOtp();
  user.otpHash = hashToken(code);
  user.otpPurpose = purpose;
  user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  const subject = purpose === 'reset-password' ? 'Code de reinitialisation Opinbase' : 'Code de verification Opinbase';
  const resetLink = `${env.frontendUrl}/forgot-password?email=${encodeURIComponent(user.email)}&step=code`;
  await sendTemplateMail({
    name: 'auth-otp',
    to: user.email,
    variables: { purpose: subject, code, expiresIn: '10 minutes', resetMessage: purpose === 'reset-password' ? `Reprenez la réinitialisation ici : ${resetLink}` : '' },
  });
}

export async function signup({ companyName, email, password }: SignupInput) {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    if (!(await verifyPassword(password, existingUser.passwordHash))) {
      throw new HttpError(401, 'Cette adresse email est deja associee a un compte. Mot de passe incorrect.');
    }

    const purpose: OtpPurpose = existingUser.emailVerified ? 'login' : 'signup';
    await sendOtp(existingUser, purpose);
    return {
      requiresOtp: true,
      email: existingUser.email,
      purpose
    };
  }

  const existingCompany = await Company.findOne({ email, user: { $exists: false } });
  const finalCompanyName = companyName || existingCompany?.name || companyNameFromEmail(email);
  const slug = createSlug(finalCompanyName);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  const company = existingCompany || await Company.create({
    name: finalCompanyName,
    email,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    freeEmailNotificationsLimit: env.freeEmailNotifications,
    unlimitedAccess: true,
    unlimitedAccessActivatedAt: new Date()
  });

  const user = await User.create({
    company: company._id,
    email,
    passwordHash: await hashPassword(password),
    roleId: 'utilisateur',
    isActive: false,
    emailVerified: false,
    mustChangePassword: false
  });

  company.user = user._id;
  await company.save();
  await user.populate('company');
  await sendOtp(user, 'signup');

  return {
    requiresOtp: true,
    email: user.email,
    purpose: 'signup'
  };
}

export async function login({ email, password }: LoginInput) {
  const user = await User.findOne({ email }).populate('company');
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'Identifiants incorrects.');
  }

  if (user.emailVerified === false) {
    await sendOtp(user, 'signup');
    return {
      requiresOtp: true,
      email: user.email,
      purpose: 'signup'
    };
  }

  if (user.isActive === false) {
    throw new HttpError(403, 'Compte desactive.');
  }

  user.lastLoginAt = new Date();
  await user.save();

  return serializeAuth(user);
}


async function telegramAuth({ initData, email, companyName }: TelegramAuthInput) {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new HttpError(503, 'La connexion Telegram n’est pas configuree.');
  }

  const telegram = verifyTelegramWebAppInitData(initData, botToken, env.telegram.authMaxAgeSeconds);
  const existingTelegramUser = await User.findOne({ telegramId: telegram.id }).populate('company');
  if (existingTelegramUser) {
    if (existingTelegramUser.isActive === false) throw new HttpError(403, 'Compte desactive.');
    existingTelegramUser.lastLoginAt = new Date();
    await existingTelegramUser.save();
    return { ...(await serializeAuth(existingTelegramUser)), isNewUser: false };
  }

  if (!email) {
    throw new HttpError(400, 'Une adresse email est requise pour creer votre entreprise.');
  }

  const existingEmailUser = await User.findOne({ email });
  if (existingEmailUser) {
    // Lier un Telegram a un compte existant reste une action authentifiee
    // (via /api/webhooks/telegram/connect), afin d’eviter une prise de compte.
    throw new HttpError(409, 'Cette adresse email est deja associee a un compte. Connectez-vous d’abord puis liez Telegram depuis vos parametres.');
  }

  const existingCompany = await Company.findOne({ email, user: { $exists: false } });
  const finalCompanyName = companyName || existingCompany?.name || telegram.username || `${telegram.firstName} entreprise`;
  const slug = createSlug(finalCompanyName);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);
  const company = existingCompany || await Company.create({
    name: finalCompanyName,
    email,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    freeEmailNotificationsLimit: env.freeEmailNotifications,
    unlimitedAccess: true,
    unlimitedAccessActivatedAt: new Date(),
  });

  const user = await User.create({
    company: company._id,
    email,
    // A password is deliberately generated only to keep the legacy email/password
    // flow compatible. It is never returned or used for Telegram authentication.
    passwordHash: await hashPassword(generateStrongPassword()),
    telegramId: telegram.id,
    roleId: 'utilisateur',
    isActive: true,
    emailVerified: false,
    mustChangePassword: false,
    notificationPreferences: { channels: { email: true, telegram: true } },
    telegramProfile: {
      chatId: telegram.id,
      username: telegram.username,
      firstName: telegram.firstName,
      lastName: telegram.lastName,
      connectedAt: new Date(),
      isActive: true,
    },
  });

  company.user = user._id;
  await company.save();
  await user.populate('company');
  return { ...(await serializeAuth(user)), isNewUser: true };
}

export async function changePassword({ user, currentPassword, newPassword }: ChangePasswordInput) {
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Mot de passe actuel incorrect.');
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new HttpError(400, "Le nouveau mot de passe doit etre different de l'ancien.");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
}

export async function forgotPassword(email: string) {
  const user = await User.findOne({ email });
  if (!user) throw new HttpError(404, 'Aucun compte trouve avec cette adresse email.');

  await sendOtp(user, 'reset-password');
}

export async function resendOtp({ email, purpose }: { email: string; purpose: OtpPurpose }) {
  const user = await User.findOne({ email });
  if (!user) throw new HttpError(404, 'Aucun compte trouve avec cette adresse email.');

  const finalPurpose: OtpPurpose = purpose === 'login' && user.emailVerified === false ? 'signup' : purpose;
  await sendOtp(user, finalPurpose);

  return {
    ok: true,
    email: user.email,
    purpose: finalPurpose
  };
}

export async function resetPassword({ email, code, password }: ResetPasswordInput) {
  const user = await User.findOne({
    email,
    otpHash: hashToken(code),
    otpPurpose: 'reset-password',
    otpExpiresAt: { $gt: new Date() }
  });

  if (!user) throw new HttpError(400, 'Code expire ou invalide.');

  user.passwordHash = await hashPassword(password);
  user.emailVerified = true;
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  user.otpHash = undefined;
  user.otpPurpose = undefined;
  user.otpExpiresAt = undefined;
  user.mustChangePassword = false;
  await user.save();
}

export async function verifyOtp({ email, code, purpose }: VerifyOtpInput) {
  const user = await User.findOne({
    email,
    otpHash: hashToken(code),
    otpPurpose: purpose,
    otpExpiresAt: { $gt: new Date() }
  }).populate('company');

  if (!user) throw new HttpError(400, 'Code expire ou invalide.');

  if (purpose === 'reset-password') {
    return { ok: true };
  }

  if (purpose === 'signup') {
    user.emailVerified = true;
    user.isActive = true;
  }

  user.otpHash = undefined;
  user.otpPurpose = undefined;
  user.otpExpiresAt = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  return serializeAuth(user);
}
