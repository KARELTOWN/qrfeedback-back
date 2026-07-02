import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';

const SUPERADMIN_EMAIL = 'kareltowanou123@gmail.com';
const SUPERADMIN_PASSWORD = 'P@ss2026.';

export async function seedSuperAdmin() {
  const company = await Company.findOneAndUpdate(
    { slug: 'qr-feedback-admin' },
    {
      $setOnInsert: {
        name: 'Opinbase Admin',
        slug: 'qr-feedback-admin',
        email: SUPERADMIN_EMAIL,
        feedbackUrl: `${env.frontendUrl}/admin`
      }
    },
    { new: true, upsert: true }
  );

  const existingUser = await User.findOne({ email: SUPERADMIN_EMAIL });
  if (existingUser) {
    existingUser.roleId = 'superadministrateur';
    existingUser.company = company._id;
    existingUser.emailVerified = true;
    existingUser.isActive = true;
    await existingUser.save();

    if (!company.user || String(company.user) !== String(existingUser._id)) {
      company.user = existingUser._id;
      await company.save();
    }
    return;
  }

  const user = await User.create({
    company: company._id,
    email: SUPERADMIN_EMAIL,
    passwordHash: await hashPassword(SUPERADMIN_PASSWORD),
    roleId: 'superadministrateur',
    isActive: true,
    emailVerified: true,
    mustChangePassword: false
  });

  company.user = user._id;
  await company.save();
}
