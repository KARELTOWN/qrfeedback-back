import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { HttpError } from '../utils/httpError.js';
import { generateStrongPassword, hashPassword } from '../utils/password.js';
import { sendMail } from './mail.service.js';
import { plans } from '../config/plans.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';

const planLabelByCode = new Map(plans.map((plan) => [plan.code, plan.label]));

function serializePayment(payment: {
  _id: unknown;
  company?: { _id?: unknown; name?: string; email?: string } | unknown;
  planCode: string;
  messages: number;
  amountFcfa: number;
  status: string;
  paidAt?: Date | null;
  createdAt?: Date | null;
  invoiceNumber?: string | null;
}) {
  const company = payment.company && typeof payment.company === 'object' ? payment.company as { _id?: unknown; name?: string; email?: string } : undefined;
  return {
    _id: payment._id,
    company,
    planCode: payment.planCode,
    planLabel: planLabelByCode.get(payment.planCode) || payment.planCode,
    messages: payment.messages,
    amountFcfa: payment.amountFcfa,
    status: payment.status,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
    invoiceNumber: payment.invoiceNumber
  };
}

export async function getAdminStats() {
  const [totalReviews, extraQrCodes, companies, totalUsers, revenue, latestTransactions, topPayers] = await Promise.all([
    Review.countDocuments(),
    CompanyQrCode.countDocuments(),
    Company.countDocuments({ slug: { $ne: 'qr-feedback-admin' } }),
    User.countDocuments(),
    Payment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, amount: { $sum: '$amountFcfa' } } }
    ]),
    Payment.find({ status: 'paid' })
      .populate('company', 'name email')
      .sort({ paidAt: -1, createdAt: -1 })
      .limit(15)
      .lean(),
    Payment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: '$company', amount: { $sum: '$amountFcfa' }, paymentsCount: { $sum: 1 } } },
      { $sort: { amount: -1 } },
      { $limit: 20 },
      { $lookup: { from: 'companies', localField: '_id', foreignField: '_id', as: 'company' } },
      { $unwind: '$company' },
      { $project: { amount: 1, paymentsCount: 1, company: { _id: '$company._id', name: '$company.name', email: '$company.email' } } }
    ])
  ]);

  return {
    totalReviews,
    totalQrCodes: companies + extraQrCodes,
    totalUsers,
    totalRevenueFcfa: revenue[0]?.amount || 0,
    latestTransactions: latestTransactions.map(serializePayment),
    topPayers
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
    .populate('company', 'name email whatsappNumber paidMessagesBalance freeMessagesLimit freeMessagesUsed')
    .select('email roleId isActive emailVerified mustChangePassword company createdAt')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
  ]);

  const pageCompanyIds = users.map((user) => user.company?._id).filter(Boolean);
  const [qrCodes, reviewCounts] = await Promise.all([
    CompanyQrCode.find({ company: { $in: pageCompanyIds }, whatsappNumber: { $exists: true, $ne: '' } })
      .select('company whatsappNumber createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    Review.aggregate([
      { $match: { company: { $in: pageCompanyIds } } },
      { $group: { _id: '$company', count: { $sum: 1 } } }
    ])
  ]);
  const qrWhatsappByCompany = new Map<string, string>();
  for (const qrCode of qrCodes) {
    const companyId = String(qrCode.company);
    if (qrCode.whatsappNumber && !qrWhatsappByCompany.has(companyId)) {
      qrWhatsappByCompany.set(companyId, qrCode.whatsappNumber);
    }
  }
  const reviewsByCompany = new Map(reviewCounts.map((item) => [String(item._id), item.count]));

  return {
    users: users.map((user) => ({
      _id: user._id,
      email: user.email,
      roleId: user.roleId || 'utilisateur',
      isActive: user.isActive !== false,
      emailVerified: user.emailVerified,
      mustChangePassword: user.mustChangePassword,
      company: user.company ? (() => {
        const company = user.company as unknown as {
          _id: unknown;
          name?: string;
          email?: string;
          whatsappNumber?: string;
          paidMessagesBalance?: number;
          freeMessagesLimit?: number;
          freeMessagesUsed?: number;
        };
        return {
          _id: company._id,
          name: company.name,
          email: company.email,
          whatsappNumber: company.whatsappNumber || qrWhatsappByCompany.get(String(company._id))
        };
      })() : user.company,
      remainingCredits: user.company ? (() => {
        const company = user.company as unknown as { paidMessagesBalance?: number; freeMessagesLimit?: number; freeMessagesUsed?: number };
        return (company.paidMessagesBalance || 0) + Math.max((company.freeMessagesLimit || 0) - (company.freeMessagesUsed || 0), 0);
      })() : 0,
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
  const [total, companies, users, qrCodes] = await Promise.all([
    Company.countDocuments(filter),
    Company.find(filter).select('name email whatsappNumber feedbackUrl user createdAt').sort({ createdAt: -1 }).lean(),
    User.find({ roleId: { $ne: 'superadministrateur' } }).select('email').lean(),
    CompanyQrCode.find({ whatsappNumber: { $exists: true, $ne: '' } }).select('company whatsappNumber createdAt').sort({ createdAt: -1 }).lean()
  ]);
  const accountEmails = new Set(users.map((user) => user.email.toLowerCase()));
  const userIdByEmail = new Map(users.map((user) => [user.email.toLowerCase(), String(user._id)]));
  const qrWhatsappByCompany = new Map<string, string>();
  for (const qrCode of qrCodes) {
    const companyId = String(qrCode.company);
    if (qrCode.whatsappNumber && !qrWhatsappByCompany.has(companyId)) {
      qrWhatsappByCompany.set(companyId, qrCode.whatsappNumber);
    }
  }
  const normalizedSearch = search.trim().toLowerCase();
  const requests = companies.map((company) => {
    const email = company.email.toLowerCase().trim();
    const userId = company.user ? String(company.user) : userIdByEmail.get(email);
    const whatsappNumber = company.whatsappNumber || qrWhatsappByCompany.get(String(company._id));

    return {
      _id: company._id,
      name: company.name,
      email: company.email,
      whatsappNumber,
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
      company.email.toLowerCase().includes(normalizedSearch) ||
      (company.whatsappNumber || '').toLowerCase().includes(normalizedSearch);
    return matchesAccount && matchesSearch;
  });
  const filteredTotal = requests.length;

  return {
    total,
    companies: requests.slice(pagination.skip, pagination.skip + pagination.limit),
    pagination: buildPagination(filteredTotal, pagination.page, pagination.limit)
  };
}

export async function getUserDetails(userId: string) {
  const user = await User.findOne({ _id: userId, roleId: { $ne: 'superadministrateur' } })
    .populate('company', 'name email whatsappNumber paidMessagesBalance freeMessagesLimit freeMessagesUsed createdAt')
    .select('email roleId isActive emailVerified mustChangePassword company createdAt')
    .lean();
  if (!user) throw new HttpError(404, 'Utilisateur introuvable.');

  const company = user.company as unknown as {
    _id: unknown;
    name: string;
    email: string;
    whatsappNumber?: string;
    paidMessagesBalance: number;
    freeMessagesLimit: number;
    freeMessagesUsed: number;
    createdAt?: Date;
  };

  const [extraQrCodes, reviewsCount, payments, revenue] = await Promise.all([
    CompanyQrCode.countDocuments({ company: company._id }),
    Review.countDocuments({ company: company._id }),
    Payment.find({ company: company._id }).sort({ createdAt: -1 }).lean(),
    Payment.aggregate([
      { $match: { company: company._id, status: 'paid' } },
      { $group: { _id: null, amount: { $sum: '$amountFcfa' } } }
    ])
  ]);

  const remainingCredits = company.paidMessagesBalance + Math.max(company.freeMessagesLimit - company.freeMessagesUsed, 0);

  return {
    user,
    company,
    qrCodesCount: extraQrCodes + 1,
    reviewsCount,
    remainingCredits,
    revenueFcfa: revenue[0]?.amount || 0,
    payments: payments.map(serializePayment)
  };
}

export async function listTransactions({ userId, startDate, endDate, page, limit }: { userId?: string; startDate?: string; endDate?: string } & PaginationInput) {
  const pagination = normalizePagination({ page, limit });
  const match: Record<string, unknown> = {};

  if (userId) {
    const user = await User.findById(userId).select('company');
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    match.company = user.company;
  }

  const createdAt: Record<string, Date> = {};
  if (startDate) createdAt.$gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) match.createdAt = createdAt;

  const [transactions, revenue, total] = await Promise.all([
    Payment.find(match).populate('company', 'name email').sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    Payment.aggregate([
      { $match: { ...match, status: 'paid' } },
      { $group: { _id: null, amount: { $sum: '$amountFcfa' } } }
    ]),
    Payment.countDocuments(match)
  ]);

  return {
    totalRevenueFcfa: revenue[0]?.amount || 0,
    transactions: transactions.map(serializePayment),
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

export async function listInactiveUsers({ page, limit }: PaginationInput = {}) {
  const pagination = normalizePagination({ page, limit });
  const users = await User.find({ roleId: { $ne: 'superadministrateur' } })
    .populate('company', 'name email paidMessagesBalance freeMessagesLimit freeMessagesUsed limitReachedAt')
    .select('email isActive emailVerified company createdAt')
    .lean();

  const companyIds = users.map((user) => (user.company as { _id?: unknown } | undefined)?._id).filter(Boolean);
  const [payments, usages] = await Promise.all([
    Payment.aggregate([
      { $match: { company: { $in: companyIds }, status: 'paid' } },
      { $group: { _id: '$company', amount: { $sum: '$amountFcfa' }, lastPaidAt: { $max: '$paidAt' }, paymentsCount: { $sum: 1 } } }
    ]),
    Review.aggregate([
      { $match: { company: { $in: companyIds }, notificationChargedAt: { $exists: true } } },
      { $group: { _id: '$company', lastUsedAt: { $max: '$notificationChargedAt' }, usedMessages: { $sum: 1 } } }
    ])
  ]);
  const paymentByCompany = new Map(payments.map((payment) => [String(payment._id), payment]));
  const usageByCompany = new Map(usages.map((usage) => [String(usage._id), usage]));
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const inactive = users
    .map((user) => {
      const company = user.company as {
        _id?: unknown;
        name?: string;
        paidMessagesBalance?: number;
        freeMessagesLimit?: number;
        freeMessagesUsed?: number;
        limitReachedAt?: Date;
      } | undefined;
      const payment = paymentByCompany.get(String(company?._id));
      const usage = usageByCompany.get(String(company?._id));
      const remainingCredits = (company?.paidMessagesBalance || 0) + Math.max((company?.freeMessagesLimit || 0) - (company?.freeMessagesUsed || 0), 0);
      const freePlanFinished = (company?.freeMessagesUsed || 0) >= (company?.freeMessagesLimit || 0);
      const hasPurchasedCredits = Boolean(payment);
      const paidCreditsRemaining = (company?.paidMessagesBalance || 0) > 0;
      const allCreditsFinished = remainingCredits <= 0;
      const lastUsedAt = usage?.lastUsedAt ? new Date(usage.lastUsedAt) : undefined;
      const lastPaidAt = payment?.lastPaidAt ? new Date(payment.lastPaidAt) : undefined;
      const limitReachedAt = company?.limitReachedAt ? new Date(company.limitReachedAt) : undefined;
      const lastUsageIsCold = lastUsedAt ? lastUsedAt.getTime() < threshold : false;
      const lastPurchaseIsCold = lastPaidAt ? lastPaidAt.getTime() < threshold : false;
      const limitReachedIsCold = limitReachedAt ? limitReachedAt.getTime() < threshold : false;

      let reason = '';
      if (lastUsageIsCold) {
        reason = 'Derniere utilisation WhatsApp il y a plus de 30 jours';
      }

      if (!reason && freePlanFinished && !hasPurchasedCredits && (limitReachedIsCold || lastUsageIsCold)) {
        reason = 'Plan gratuit termine sans achat depuis 30 jours';
      }

      if (!reason && hasPurchasedCredits && paidCreditsRemaining && lastUsageIsCold) {
        reason = 'Credits disponibles mais aucune utilisation depuis 30 jours';
      }

      if (!reason && hasPurchasedCredits && allCreditsFinished && (lastPurchaseIsCold || limitReachedIsCold)) {
        reason = 'Credits termines sans renouvellement depuis 30 jours';
      }

      return {
        user,
        company,
        remainingCredits,
        revenueFcfa: payment?.amount || 0,
        lastPaidAt: payment?.lastPaidAt,
        lastUsedAt: usage?.lastUsedAt,
        reason
      };
    })
    .filter((item) => item.reason);

  return {
    users: inactive.slice(pagination.skip, pagination.skip + pagination.limit),
    pagination: buildPagination(inactive.length, pagination.page, pagination.limit)
  };
}
