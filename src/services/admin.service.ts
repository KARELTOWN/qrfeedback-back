import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { QrScan } from '../models/QrScan.js';
import { Review } from '../models/Review.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { generateStrongPassword, hashPassword } from '../utils/password.js';
import { sendTemplateMail } from './notificationTemplate.service.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

export async function getAdminStats() {
  const [totalReviews, extraQrCodes, companies, totalUsers] = await Promise.all([
    Review.countDocuments(),
    CompanyQrCode.countDocuments(),
    Company.countDocuments({ slug: { $ne: 'qr-feedback-admin' } }),
    User.countDocuments()
  ]);

  return {
    totalReviews,
    totalQrCodes: companies + extraQrCodes,
    totalUsers,
    totalRevenueFcfa: 0,
    latestTransactions: [],
    topPayers: []
  };
}

export async function listUsers(input: PaginationInput & { search?: string } = {}) {
  const pagination = normalizePagination(input);
  const search = input.search?.trim();
  const companyIds = search
    ? await Company.find({ name: { $regex: search, $options: 'i' } }).distinct('_id')
    : [];
  const match = {
    roleId: { $ne: 'superadministrateur' },
    ...(search ? {
      $or: [
        { email: { $regex: search, $options: 'i' } },
        { company: { $in: companyIds } }
      ]
    } : {})
  };

  const [total, users] = await Promise.all([
    User.countDocuments(match),
    User.find(match)
      .populate('company', 'name email')
      .select('email roleId isActive emailVerified mustChangePassword company createdAt')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
  ]);

  const pageCompanyIds = users.map((user) => user.company?._id).filter(Boolean);
  const reviewCounts = await Review.aggregate([
    { $match: { company: { $in: pageCompanyIds } } },
    { $group: { _id: '$company', count: { $sum: 1 } } }
  ]);
  const reviewsByCompany = new Map(reviewCounts.map((item) => [String(item._id), item.count]));

  return {
    users: users.map((user) => ({
      _id: user._id,
      email: user.email,
      roleId: user.roleId || 'utilisateur',
      isActive: user.isActive !== false,
      emailVerified: user.emailVerified,
      mustChangePassword: user.mustChangePassword,
      company: user.company,
      remainingCredits: null,
      reviewsCount: user.company ? reviewsByCompany.get(String(user.company._id)) || 0 : 0,
      createdAt: user.createdAt
    })),
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

export async function generateUserPassword(userId: string) {
  const user = await User.findOne({ _id: userId, roleId: { $ne: 'superadministrateur' } }).populate('company', 'name email');
  if (!user) throw new HttpError(404, 'Utilisateur introuvable.');

  const password = generateStrongPassword();
  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = true;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await sendTemplateMail({
    name: 'admin-password-reset',
    to: user.email,
    variables: { password },
    subject: 'Nouveau mot de passe Opinbase',
    html: `
      <p>Bonjour,</p>
      <p>Un nouveau mot de passe a ete genere pour votre compte Opinbase.</p>
      <p style="font-size: 20px; font-weight: 700;">${password}</p>
      <p>Connectez-vous puis changez ce mot de passe depuis vos reglages.</p>
    `
  });

  return { ok: true };
}

export async function setUserActive(userId: string, isActive: boolean) {
  const user = await User.findOne({ _id: userId, roleId: { $ne: 'superadministrateur' } });
  if (!user) throw new HttpError(404, 'Utilisateur introuvable.');

  user.isActive = isActive;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  try {
    await sendTemplateMail({
      name: 'account-status-changed',
      to: user.email,
      variables: {
        statusLabel: isActive ? 'reactive' : 'desactive',
        statusMessage: isActive
          ? 'Vous pouvez de nouveau vous connecter a votre espace Opinbase.'
          : "Vous ne pouvez plus vous connecter tant qu'il n'a pas ete reactive. Contactez le support si vous pensez qu'il s'agit d'une erreur."
      }
    });
  } catch (error) {
    logger.warn('notification:account-status:failed', {
      userId: String(user._id),
      isActive,
      error: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }

  return {
    id: user._id,
    isActive: user.isActive
  };
}

export async function listQrRequests({
  page,
  limit,
  accountFilter = 'all',
  search = ''
}: PaginationInput & { accountFilter?: 'all' | 'with' | 'without'; search?: string }) {
  const pagination = normalizePagination({ page, limit });
  const filter = { slug: { $ne: 'qr-feedback-admin' } };
  const [companies, users] = await Promise.all([
    Company.find(filter).select('name email feedbackUrl user createdAt').sort({ createdAt: 1 }).lean(),
    User.find({ roleId: { $ne: 'superadministrateur' } }).select('email isActive lastLoginAt').lean()
  ]);
  const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

  const grouped = new Map<string, {
    email: string;
    name: string;
    createdAt: Date;
    qrRequestsCount: number;
    userId?: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    status: 'active' | 'inactive' | 'disabled' | 'none';
  }>();

  for (const company of companies) {
    const email = company.email.toLowerCase().trim();
    const account = userByEmail.get(email);
    const existing = grouped.get(email);

    if (existing) {
      existing.qrRequestsCount += 1;
      continue;
    }

    let status: 'active' | 'inactive' | 'disabled' | 'none' = 'none';
    if (account) {
      status = account.isActive === false ? 'disabled' : account.lastLoginAt ? 'active' : 'inactive';
    }

    grouped.set(email, {
      email: company.email,
      name: company.name,
      createdAt: company.createdAt,
      qrRequestsCount: 1,
      userId: account ? String(account._id) : undefined,
      isActive: account ? account.isActive !== false : false,
      lastLoginAt: account?.lastLoginAt ?? null,
      status
    });
  }

  const normalizedSearch = search.trim().toLowerCase();
  const rows = Array.from(grouped.values()).filter((row) => {
    const matchesAccount =
      accountFilter === 'all' ||
      (accountFilter === 'with' && row.status !== 'none') ||
      (accountFilter === 'without' && row.status === 'none');
    const matchesSearch =
      !normalizedSearch ||
      row.name.toLowerCase().includes(normalizedSearch) ||
      row.email.toLowerCase().includes(normalizedSearch);
    return matchesAccount && matchesSearch;
  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    total: rows.length,
    companies: rows.slice(pagination.skip, pagination.skip + pagination.limit),
    pagination: buildPagination(rows.length, pagination.page, pagination.limit)
  };
}

export async function getUserDetails(userId: string) {
  const user = await User.findOne({ _id: userId, roleId: { $ne: 'superadministrateur' } })
    .populate('company', 'name email createdAt')
    .select('email roleId isActive emailVerified mustChangePassword lastLoginAt company createdAt')
    .lean();
  if (!user) throw new HttpError(404, 'Utilisateur introuvable.');

  const company = user.company as unknown as { _id: unknown; name: string; email: string; createdAt?: Date };
  const [extraQrCodes, reviewsCount, scanCount] = await Promise.all([
    CompanyQrCode.countDocuments({ company: company._id }),
    Review.countDocuments({ company: company._id }),
    QrScan.countDocuments({ company: company._id })
  ]);

  return {
    user,
    company,
    qrCodesCount: extraQrCodes + 1,
    reviewsCount,
    scanCount,
    remainingCredits: null,
    revenueFcfa: 0,
    payments: []
  };
}

export async function listTransactions({
  page,
  limit,
  userId,
  startDate,
  endDate
}: PaginationInput & { userId?: string; startDate?: string; endDate?: string }) {
  void userId;
  void startDate;
  void endDate;
  const pagination = normalizePagination({ page, limit });
  return {
    totalRevenueFcfa: 0,
    transactions: [],
    pagination: buildPagination(0, pagination.page, pagination.limit)
  };
}

export async function listInactiveUsers({ page, limit }: PaginationInput = {}) {
  const pagination = normalizePagination({ page, limit });
  return {
    users: [],
    pagination: buildPagination(0, pagination.page, pagination.limit)
  };
}
