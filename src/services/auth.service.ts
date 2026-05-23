import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { User, type IUser } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { createSlug } from '../utils/slug.js';
import { hashPassword, hashToken, verifyPassword } from '../utils/password.js';
import { generateQrDataUrl } from './qr.service.js';
import { sendMail } from './mail.service.js';
import { readFileSecret } from './fileSecret.service.js';
import { ensureDefaultContactList } from './contactList.service.js';

type SignupInput = {
  companyName?: string;
  email: string;
  password: string;
};

type LoginInput = {
  email: string;
  password: string;
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

async function getJwtSecret() {
  return (await readFileSecret('jwtSecret')) || env.jwtSecret;
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

  const subject = purpose === 'reset-password' ? 'Code de reinitialisation QR Feedback' : 'Code de verification QR Feedback';
  const resetLink = `${env.frontendUrl}/forgot-password?email=${encodeURIComponent(user.email)}&step=code`;
  await sendMail({
    to: user.email,
    subject,
    html: `
      <p>Votre code QR Feedback est :</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
      ${purpose === 'reset-password' ? `
        <p>Si vous avez ferme la page, reprenez la reinitialisation ici :</p>
        <p><a href="${resetLink}">Changer mon mot de passe</a></p>
      ` : ''}
      <p>Ce code expire dans 10 minutes.</p>
    `
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
    freeMessagesLimit: env.freeWhatsappMessages
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
  await ensureDefaultContactList(company, user._id);
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

  return serializeAuth(user);
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
  await user.save();

  return serializeAuth(user);
}
