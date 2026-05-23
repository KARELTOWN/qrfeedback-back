import type { HydratedDocument } from "mongoose";
import { env } from "../config/env.js";
import type { ICompany } from "../models/Company.js";
import type { IReview } from "../models/Review.js";
import { Company } from "../models/Company.js";
import { CompanyQrCode, type ICompanyQrCode } from "../models/CompanyQrCode.js";
import { ContactActivity } from "../models/ContactActivity.js";
import { Review } from "../models/Review.js";
import { WhatsappMessageLog } from "../models/WhatsappMessageLog.js";
import { HttpError } from "../utils/httpError.js";
import { sendWhatsapp, sendWhatsappTemplate } from "./whatsapp.service.js";
import { buildReminderSchedule } from "./company.service.js";
import { cleanAnswerValue, getCompanyFeedbackFormConfig, getEnabledField } from "./feedbackForm.service.js";
import { addContactToList, upsertContact } from "./contact.service.js";
import { resolveQrFormListMappingForFeedback } from "./qrFormListMapping.service.js";
import { dispatchAutomationTrigger } from "./automationTriggerDispatcher.service.js";
import { appLogger } from "../utils/appLogger.js";

type ReviewInput = {
  serviceFeedback?: string;
  customAnswers?: Array<{ questionId: string; value: unknown }>;
  rating: number;
};

type NormalizedAnswer = {
  questionId: string;
  label: string;
  type: 'text' | 'textarea' | 'rating' | 'select' | 'email' | 'phone';
  value: unknown;
};

type WhatsappCloudStatusInput = {
  messageId: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
};

function reviewWhatsappBody(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
) {
  const lines = [
    `Nouvel avis pour ${company.name}`,
    `Note: ${review.rating}/5`,
  ];

  if (review.serviceFeedback) lines.push(`Expérience: ${review.serviceFeedback}`);

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        lines.push(`${answer.label}: ${answer.value}`);
      }
    }
  }

  return lines.join("\n");
}

function reviewWhatsappTemplateComponents(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
) {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: company.name },
        { type: "text", text: `${review.rating}/5` },
        { type: "text", text: review.serviceFeedback || "-" },
      ],
    },
  ];
}

function valueToString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function inferNameField(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('prenom') || normalized.includes('prénom') || normalized.includes('first')) return 'first_name';
  if (normalized.includes('nom') || normalized.includes('last')) return 'last_name';
  return undefined;
}

function applyMappedValue(target: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  rating?: number;
  tags: string[];
  customFields: Record<string, unknown>;
}, key: string, value: unknown) {
  const text = valueToString(value);
  if (value === undefined || value === null || value === '') return;

  if (key === 'first_name') target.firstName = target.firstName || text;
  else if (key === 'last_name') target.lastName = target.lastName || text;
  else if (key === 'email') target.email = target.email || text;
  else if (key === 'phone') target.phone = target.phone || text;
  else if (key === 'whatsapp') target.whatsapp = target.whatsapp || text;
  else if (key === 'rating') target.rating = Number(value);
  else if (key === 'tags') {
    if (Array.isArray(value)) target.tags.push(...value.map(String));
    else if (text) target.tags.push(...text.split(',').map((tag) => tag.trim()));
  } else {
    target.customFields[key] = value;
  }
}

function buildContactPayloadFromFeedback({
  review,
  customAnswers,
  fieldMappings
}: {
  review: HydratedDocument<IReview>;
  customAnswers: NormalizedAnswer[];
  fieldMappings: Array<{ formFieldKey: string; listAttributeKey: string }>;
}) {
  const target = {
    firstName: undefined as string | undefined,
    lastName: undefined as string | undefined,
    email: undefined as string | undefined,
    phone: undefined as string | undefined,
    whatsapp: undefined as string | undefined,
    rating: review.rating,
    tags: [] as string[],
    customFields: {} as Record<string, unknown>
  };
  const answerById = new Map(customAnswers.map((answer) => [answer.questionId, answer]));

  for (const mapping of fieldMappings) {
    const key = mapping.listAttributeKey.trim().toLowerCase();
    if (mapping.formFieldKey === 'rating') applyMappedValue(target, key, review.rating);
    else if (mapping.formFieldKey === 'serviceFeedback') applyMappedValue(target, key, review.serviceFeedback);
    else {
      const answer = answerById.get(mapping.formFieldKey);
      if (answer) applyMappedValue(target, key, answer.value);
    }
  }

  for (const answer of customAnswers) {
    if (answer.type === 'email' && !target.email) target.email = valueToString(answer.value);
    if (answer.type === 'phone') {
      if (!target.whatsapp) target.whatsapp = valueToString(answer.value);
      if (!target.phone) target.phone = valueToString(answer.value);
    }

    const inferredNameField = inferNameField(answer.label);
    if (inferredNameField) applyMappedValue(target, inferredNameField, answer.value);
  }

  target.customFields.rating = review.rating;
  if (review.serviceFeedback) target.customFields.service_feedback = review.serviceFeedback;
  for (const answer of customAnswers) {
    target.customFields[answer.questionId] = answer.value;
  }

  return target;
}

async function syncReviewContactAndList({
  company,
  review,
  qrCode,
  customAnswers
}: {
  company: HydratedDocument<ICompany>;
  review: HydratedDocument<IReview>;
  qrCode?: HydratedDocument<ICompanyQrCode>;
  customAnswers: NormalizedAnswer[];
}) {
  const mapping = await resolveQrFormListMappingForFeedback(company, qrCode);
  if (!mapping.autoCreateContact && !mapping.autoAddToList) return;

  const contactPayload = buildContactPayloadFromFeedback({
    review,
    customAnswers,
    fieldMappings: (mapping.fieldMappings || []).map((fieldMapping) => ({
      formFieldKey: fieldMapping.formFieldKey,
      listAttributeKey: fieldMapping.listAttributeKey
    }))
  });

  const { contact } = await upsertContact({
    company,
    ...contactPayload,
    source: 'qr_feedback',
    lastFeedbackAt: review.createdAt || new Date()
  });

  review.contact = contact._id;

  if (mapping.autoAddToList) {
    const { list } = await addContactToList({
      company,
      contact,
      listId: mapping.list,
      attributes: contactPayload.customFields
    });
    review.contactList = list._id;
  }

  await review.save();
}

function buildAutomationContext({
  company,
  review,
  qrCode,
  customAnswers
}: {
  company: HydratedDocument<ICompany>;
  review: HydratedDocument<IReview>;
  qrCode?: HydratedDocument<ICompanyQrCode>;
  customAnswers: NormalizedAnswer[];
}) {
  const customFields = Object.fromEntries(customAnswers.map((answer) => [answer.questionId, answer.value]));
  return {
    company_id: String(company._id),
    feedback_id: String(review._id),
    form_id: qrCode ? String(qrCode._id) : undefined,
    qr_code_id: qrCode ? String(qrCode._id) : undefined,
    contact_id: review.contact ? String(review.contact) : undefined,
    list_id: review.contactList ? String(review.contactList) : undefined,
    rating: review.rating,
    submitted_at: review.createdAt || new Date(),
    feedback: {
      id: String(review._id),
      rating: review.rating,
      serviceFeedback: review.serviceFeedback,
      customAnswers
    },
    contact: {
      id: review.contact ? String(review.contact) : undefined
    },
    custom_fields: customFields
  };
}

export async function createReviewAndNotify(
  company: HydratedDocument<ICompany>,
  payload: ReviewInput,
  qrCode?: HydratedDocument<ICompanyQrCode>,
) {
  const formConfig = getCompanyFeedbackFormConfig(company);
  const customAnswers = normalizeCustomAnswers(formConfig.customQuestions, payload.customAnswers || []);
  validateRequiredAnswers(formConfig, payload, customAnswers);

  const review = await Review.create({
    company: company._id,
    qrCode: qrCode?._id,
    serviceFeedback: getEnabledField(formConfig, "serviceFeedback") ? payload.serviceFeedback : undefined,
    customAnswers,
    rating: payload.rating,
  });
  appLogger.info('review', 'created', {
    reviewId: String(review._id),
    companyId: String(company._id),
    qrCodeId: qrCode ? String(qrCode._id) : undefined,
    rating: review.rating
  });

  await syncReviewContactAndList({ company, review, qrCode, customAnswers });
  const automationDispatch = await dispatchAutomationTrigger({
    company,
    type: 'feedback_submitted',
    context: buildAutomationContext({ company, review, qrCode, customAnswers })
  });
  appLogger.info('review', 'automation dispatched', {
    reviewId: String(review._id),
    executionsCount: automationDispatch.executionsCount
  });

  const hasFreeCredit = company.freeMessagesUsed < company.freeMessagesLimit;
  const hasPaidCredit = company.paidMessagesBalance > 0;
  const reservedMessages = await Review.countDocuments({
    company: company._id,
    _id: { $ne: review._id },
    notificationStatus: { $in: ["pending", "queued"] },
    notificationChargedAt: { $exists: false },
  });
  const availableMessages =
    company.freeMessagesLimit -
    company.freeMessagesUsed +
    company.paidMessagesBalance -
    reservedMessages;

  if ((!hasFreeCredit && !hasPaidCredit) || availableMessages <= 0) {
    await markLimitReached(company);
    review.notificationStatus = "skipped";
    await review.save();
    appLogger.warn('review:whatsapp', 'skipped: no credits', { reviewId: String(review._id), availableMessages });
    return review;
  }

  const notificationNumber = qrCode?.whatsappNumber || company.whatsappNumber;

  if (!notificationNumber) {
    review.notificationStatus = "skipped";
    review.notificationError =
      "Aucun numero WhatsApp configure pour cette entreprise.";
    await review.save();
    appLogger.warn('review:whatsapp', 'skipped: no notification number', { reviewId: String(review._id) });
    return review;
  }

  try {
    appLogger.info('review:whatsapp', 'send notification', { reviewId: String(review._id), to: notificationNumber });
    const messageSend = env.whatsappCloud.reviewTemplateName
      ? await sendWhatsappTemplate({
        company,
        to: notificationNumber,
        templateName: env.whatsappCloud.reviewTemplateName,
        languageCode: env.whatsappCloud.reviewTemplateLanguageCode,
        components: reviewWhatsappTemplateComponents(company, review),
        contactId: review.contact || undefined,
      })
      : await sendWhatsapp({
        company,
        to: notificationNumber,
        body: reviewWhatsappBody(company, review),
        contactId: review.contact || undefined,
      });

    review.notificationStatus = "queued";
    review.notificationWhatsappNumber = notificationNumber;
    review.notificationProvider = "whatsapp_cloud_api";
    review.notificationProviderMessageId = messageSend.id;
    review.notificationChargedAt = messageSend.creditChargedAt;
    if (review.contact) {
      await ContactActivity.create({
        company: company._id,
        contact: review.contact,
        type: "message_sent",
        channel: "whatsapp",
        direction: "outbound",
        provider: "whatsapp_cloud_api",
        providerMessageId: messageSend.id,
        title: "Message WhatsApp envoye",
        metadata: { reviewId: String(review._id) },
        occurredAt: new Date()
      });
    }
  } catch (error) {
    review.notificationStatus = "failed";
    review.notificationError =
      error instanceof Error ? error.message : "Erreur inconnue";
    appLogger.error('review:whatsapp', 'send failed', { reviewId: String(review._id), message: review.notificationError });
  }

  await review.save();
  return review;
}

export async function createReviewForCompany(
  slug: string,
  payload: ReviewInput,
) {
  const company = await Company.findOne({ slug });
  if (company) return createReviewAndNotify(company, payload);

  const qrCode = await CompanyQrCode.findOne({ slug });
  if (!qrCode) throw new HttpError(404, "Entreprise introuvable.");

  const qrCompany = await Company.findById(qrCode.company);
  if (!qrCompany) throw new HttpError(404, "Entreprise introuvable.");

  return createReviewAndNotify(qrCompany, payload, qrCode);
}

function normalizeCustomAnswers(
  questions: ReturnType<typeof getCompanyFeedbackFormConfig>["customQuestions"],
  answers: Array<{ questionId: string; value: unknown }>,
) {
  const answerById = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  return questions
    .map((question) => {
      const rawValue = answerById.get(question.id);
      const hasRawValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "";
      const value = cleanAnswerValue(question.type, rawValue);
      if (hasRawValue && value === undefined) {
        throw new HttpError(400, `${question.label} est invalide.`);
      }
      return {
        questionId: question.id,
        label: question.label,
        type: question.type,
        value,
      };
    })
    .filter((answer) => answer.value !== undefined && answer.value !== "");
}

function validateRequiredAnswers(
  config: ReturnType<typeof getCompanyFeedbackFormConfig>,
  payload: ReviewInput,
  customAnswers: Array<{ questionId: string; value: unknown }>,
) {
  for (const field of config.fields) {
    if (!field.enabled || !field.required) continue;
    const value = payload[field.key as keyof ReviewInput];
    if (!String(value || "").trim()) throw new HttpError(400, `${field.label} est requis.`);
  }

  const customAnswerIds = new Set(customAnswers.map((answer) => answer.questionId));
  for (const question of config.customQuestions) {
    if (question.required && !customAnswerIds.has(question.id)) {
      throw new HttpError(400, `${question.label} est requis.`);
    }
  }
}

async function markLimitReached(company: HydratedDocument<ICompany>) {
  if (!company.limitReachedAt) {
    company.limitReachedAt = new Date();
    company.set(
      "reminderSchedule",
      buildReminderSchedule(company.limitReachedAt),
    );
  }
  await company.save();
}

export async function handleWhatsappCloudMessageStatus({
  messageId,
  status,
  errorCode,
  errorMessage,
}: WhatsappCloudStatusInput) {
  const review = await Review.findOne({
    notificationProviderMessageId: messageId,
  });
  if (!review) return { handled: false };

  const normalizedStatus = status.toLowerCase();

  if (["sent", "delivered", "read"].includes(normalizedStatus)) {
    review.notificationStatus =
      normalizedStatus === "delivered" || normalizedStatus === "read"
        ? "delivered"
        : "sent";
    review.notificationError = undefined;

    if (!review.notificationChargedAt) {
      const chargedLog = await WhatsappMessageLog.findOne({
        providerMessageId: messageId,
        creditChargedAt: { $exists: true },
        creditRefundedAt: { $exists: false }
      }).sort({ creditChargedAt: -1 });
      if (chargedLog?.creditChargedAt) {
        review.notificationChargedAt = chargedLog.creditChargedAt;
      }
    }

    if (!review.notificationChargedAt) {
      const company = await Company.findById(review.company);
      if (company) {
        if (company.freeMessagesUsed < company.freeMessagesLimit) {
          company.freeMessagesUsed += 1;
        } else if (company.paidMessagesBalance > 0) {
          company.paidMessagesBalance -= 1;
        } else {
          await markLimitReached(company);
          review.notificationError =
            "Message envoyé sans crédit disponible au moment du callback WhatsApp.";
        }

        if (!review.notificationError) {
          if (
            company.freeMessagesUsed >= company.freeMessagesLimit &&
            company.paidMessagesBalance <= 0
          ) {
            await markLimitReached(company);
          } else {
            await company.save();
          }
          review.notificationChargedAt = new Date();
        }
      }
    }

    review.notifiedAt = review.notifiedAt || new Date();
  } else if (normalizedStatus === "failed") {
    review.notificationStatus = "failed";
    review.notificationError =
      errorMessage || errorCode || `WhatsApp status: ${normalizedStatus}`;
  } else if (["accepted", "queued", "pending"].includes(normalizedStatus)) {
    review.notificationStatus = "queued";
  }

  await review.save();
  return { handled: true };
}
