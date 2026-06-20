import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { generateStrongPassword, hashPassword } from '../utils/password.js';
import { sendMail } from './mail.service.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';

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

  await sendMail({
    to: user.email,
    subject: 'Nouveau mot de passe QR Feedback',
    html: `
      <p>Bonjour,</p>
      <p>Un nouveau mot de passe a ete genere pour votre compte QR Feedback.</p>
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
  const [total, companies, users] = await Promise.all([
    Company.countDocuments(filter),
    Company.find(filter).select('name email feedbackUrl user createdAt').sort({ createdAt: -1 }).lean(),
    User.find({ roleId: { $ne: 'superadministrateur' } }).select('email').lean()
  ]);
  const accountEmails = new Set(users.map((user) => user.email.toLowerCase()));
  const userIdByEmail = new Map(users.map((user) => [user.email.toLowerCase(), String(user._id)]));
  const normalizedSearch = search.trim().toLowerCase();
  const requests = companies.map((company) => {
    const email = company.email.toLowerCase().trim();
    const userId = company.user ? String(company.user) : userIdByEmail.get(email);

    return {
      _id: company._id,
      name: company.name,
      email: company.email,
      feedbackUrl: company.feedbackUrl,
      createdAt: company.createdAt,
      hasAccount: Boolean(userId) || accountEmails.has(email),
      userId
    };
  }).filter((company) => {
    const matchesAccount =
      accountFilter === 'all' ||
      (accountFilter === 'with' && company.hasAccount) ||
      (accountFilter === 'without' && !company.hasAccount);
    const matchesSearch =
      !normalizedSearch ||
      company.name.toLowerCase().includes(normalizedSearch) ||
      company.email.toLowerCase().includes(normalizedSearch);
    return matchesAccount && matchesSearch;
  });

  return {
    total,
    companies: requests.slice(pagination.skip, pagination.skip + pagination.limit),
    pagination: buildPagination(requests.length, pagination.page, pagination.limit)
  };
}

export async function getUserDetails(userId: string) {
  const user = await User.findOne({ _id: userId, roleId: { $ne: 'superadministrateur' } })
    .populate('company', 'name email createdAt')
    .select('email roleId isActive emailVerified mustChangePassword company createdAt')
    .lean();
  if (!user) throw new HttpError(404, 'Utilisateur introuvable.');

  const company = user.company as unknown as { _id: unknown; name: string; email: string; createdAt?: Date };
  const [extraQrCodes, reviewsCount] = await Promise.all([
    CompanyQrCode.countDocuments({ company: company._id }),
    Review.countDocuments({ company: company._id })
  ]);

  return {
    user,
    company,
    qrCodesCount: extraQrCodes + 1,
    reviewsCount,
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
