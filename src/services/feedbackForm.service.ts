import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';

export type FeedbackFieldKey = 'serviceFeedback';
export type CustomQuestionType = 'text' | 'textarea' | 'rating' | 'select' | 'email' | 'phone';

export type FeedbackFieldConfig = {
  key: FeedbackFieldKey;
  label: string;
  placeholder?: string;
  enabled: boolean;
  required: boolean;
};

export type CustomQuestionConfig = {
  id: string;
  type: CustomQuestionType;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
};

export type FeedbackFormConfig = {
  title: string;
  fields: FeedbackFieldConfig[];
  customQuestions: CustomQuestionConfig[];
};

const fieldDefaults: FeedbackFieldConfig[] = [
  { key: 'serviceFeedback', label: 'Parlez-nous de votre expérience', placeholder: '', enabled: true, required: false }
];

const allowedFieldKeys = new Set(fieldDefaults.map((field) => field.key));
const allowedQuestionTypes = new Set<CustomQuestionType>(['text', 'textarea', 'rating', 'select', 'email', 'phone']);
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+[1-9]\d{7,14}$/;

function cleanText(value: unknown, fallback = '') {
  return String(value || fallback).trim().slice(0, 180);
}

function cleanLongText(value: unknown, fallback = '') {
  return String(value || fallback).trim().slice(0, 500);
}

function toBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function getDefaultFeedbackFormConfig(companyName?: string): FeedbackFormConfig {
  return {
    title: companyName ? `Votre avis compte pour ${companyName}` : 'Votre avis compte',
    fields: fieldDefaults.map((field) => ({ ...field })),
    customQuestions: []
  };
}

export function normalizeFeedbackFormConfig(raw: unknown, companyName?: string): FeedbackFormConfig {
  const defaults = getDefaultFeedbackFormConfig(companyName);
  const source = raw && typeof raw === 'object' ? raw as Partial<FeedbackFormConfig> : {};
  const sourceFields = Array.isArray(source.fields) ? source.fields : [];
  const sourceByKey = new Map(sourceFields.map((field) => [field?.key, field]));

  return {
    title: cleanText(source.title, defaults.title) || defaults.title,
    fields: defaults.fields.map((defaultField) => {
      const sourceField = sourceByKey.get(defaultField.key) as Partial<FeedbackFieldConfig> | undefined;
      return {
        key: defaultField.key,
        label: cleanText(sourceField?.label, defaultField.label) || defaultField.label,
        placeholder: cleanText(sourceField?.placeholder, defaultField.placeholder || ''),
        enabled: toBoolean(sourceField?.enabled, defaultField.enabled),
        required: toBoolean(sourceField?.required, defaultField.required)
      };
    }),
    customQuestions: (Array.isArray(source.customQuestions) ? source.customQuestions : [])
      .map((question, index) => normalizeCustomQuestion(question, index))
      .filter((question): question is CustomQuestionConfig => Boolean(question))
      .slice(0, 8)
  };
}

function normalizeCustomQuestion(raw: unknown, index: number): CustomQuestionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const question = raw as Partial<CustomQuestionConfig>;
  const type = allowedQuestionTypes.has(question.type as CustomQuestionType) ? question.type as CustomQuestionType : 'text';
  const label = cleanText(question.label);
  if (!label) return null;

  const id = cleanText(question.id, `question_${Date.now()}_${index}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const options = Array.isArray(question.options)
    ? question.options.map((option) => cleanText(option)).filter(Boolean).slice(0, 12)
    : [];

  return {
    id: id || `question_${Date.now()}_${index}`,
    type,
    label,
    placeholder: cleanText(question.placeholder),
    required: toBoolean(question.required),
    options: type === 'select' ? options : []
  };
}

export function getCompanyFeedbackFormConfig(company: HydratedDocument<ICompany>) {
  return normalizeFeedbackFormConfig(company.feedbackFormConfig, company.name);
}

export function sanitizeFeedbackFormConfig(payload: unknown, companyName?: string) {
  const config = normalizeFeedbackFormConfig(payload, companyName);
  return {
    ...config,
    fields: config.fields.filter((field) => allowedFieldKeys.has(field.key))
  };
}

export function getEnabledField(config: FeedbackFormConfig, key: FeedbackFieldKey) {
  return config.fields.find((field) => field.key === key && field.enabled);
}

export function cleanAnswerValue(type: CustomQuestionType, value: unknown) {
  if (type === 'rating') {
    const numberValue = Number(value);
    return Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= 5 ? numberValue : undefined;
  }
  if (type === 'email') {
    const email = cleanText(value).toLowerCase();
    return emailRegex.test(email) ? email : undefined;
  }
  if (type === 'phone') {
    const phone = String(value || '').replace(/\s/g, '');
    return phoneRegex.test(phone) ? phone : undefined;
  }
  return cleanLongText(value);
}
