import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import type { ICompany } from '../models/Company.js';
import type { ICompanyQrCode } from '../models/CompanyQrCode.js';
import { Review, type IReview } from '../models/Review.js';
import { buildReviewsCollectionSchema, reviewsCollectionName } from '../typesense/reviews.schema.js';

let collectionReady = false;
let collectionReadyPromise: Promise<void> | null = null;

export class TypesenseRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
  }
}

type TypesenseSearchHit<T> = {
  document: T;
  vector_distance?: number;
};

type TypesenseSearchResponse<T> = {
  found?: number;
  hits?: Array<TypesenseSearchHit<T>>;
};

export type ReviewSearchFilters = {
  query?: string;
  rating?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  notificationStatus?: string;
  qrCodeId?: string;
  startDate?: string;
  endDate?: string;
};

export type ReviewSearchDocument = {
  id: string;
  companyId: string;
  qrCodeId?: string;
  qrCodeLabel?: string;
  rating: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;
  serviceFeedback: string;
  answersText: string;
  searchText: string;
  notificationStatus: string;
  createdAt: number;
};

function baseUrl() {
  return `${env.typesense.protocol}://${env.typesense.host}:${env.typesense.port}`;
}

export function isTypesenseEnabled() {
  return Boolean(env.typesense.apiKey);
}

async function typesenseRequest<T>(path: string, init: RequestInit = {}) {
  if (!isTypesenseEnabled()) throw new Error('Typesense API key is not configured.');

  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-TYPESENSE-API-KEY': env.typesense.apiKey,
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TypesenseRequestError(`Typesense ${response.status}: ${body || response.statusText}`, response.status, body);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function ensureReviewsCollection() {
  if (!isTypesenseEnabled() || collectionReady) return;
  if (collectionReadyPromise) return collectionReadyPromise;

  collectionReadyPromise = (async () => {
    const exists = await fetch(`${baseUrl()}/collections/${reviewsCollectionName}`, {
      headers: { 'X-TYPESENSE-API-KEY': env.typesense.apiKey }
    }).then((response) => response.ok).catch(() => false);

    if (!exists) {
      await typesenseRequest('/collections', {
        method: 'POST',
        body: JSON.stringify(buildReviewsCollectionSchema())
      });
    }

    collectionReady = true;
  })().finally(() => {
    collectionReadyPromise = null;
  });

  return collectionReadyPromise;
}

function markReviewsCollectionStale() {
  collectionReady = false;
  collectionReadyPromise = null;
}

async function reindexCompanyReviewsById(companyId: string) {
  const reviews = await Review.find({ company: companyId }).populate('qrCode', 'label').sort({ createdAt: -1 });
  for (const review of reviews) {
    await indexReview(review);
  }
}

function stringifyAnswerValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(stringifyAnswerValue).filter(Boolean).join(', ');
  return String(value).trim();
}

export function buildReviewText(review: Pick<IReview, 'serviceFeedback' | 'customAnswers' | 'rating'>) {
  const parts = [
    review.serviceFeedback || '',
    ...(review.customAnswers || []).map((answer) => `${answer.label}: ${stringifyAnswerValue(answer.value)}`),
    `Note ${review.rating}/5`
  ];
  return parts.map((part) => part.trim()).filter(Boolean).join('\n');
}

export function inferSentiment(review: Pick<IReview, 'serviceFeedback' | 'customAnswers' | 'rating'>) {
  const text = buildReviewText(review).toLowerCase();
  const positiveWords = ['excellent', 'parfait', 'super', 'bon', 'bonne', 'genial', 'génial', 'merci', 'satisfait', 'rapide', 'propre', 'accueillant', 'aime', 'adoré', 'adore'];
  const negativeWords = ['mauvais', 'nul', 'lent', 'attente', 'retard', 'cher', 'sale', 'déçu', 'decu', 'problème', 'probleme', 'plainte', 'impoli', 'froid', 'jamais', 'insatisfait'];
  const positiveHits = positiveWords.filter((word) => text.includes(word)).length;
  const negativeHits = negativeWords.filter((word) => text.includes(word)).length;
  const ratingScore = review.rating >= 4 ? 1 : review.rating <= 2 ? -1 : 0;
  const score = ratingScore + positiveHits * 0.35 - negativeHits * 0.45;

  return {
    sentiment: score > 0.35 ? 'positive' as const : score < -0.35 ? 'negative' as const : 'neutral' as const,
    sentimentScore: Number(score.toFixed(2))
  };
}

function inferQuerySentiment(query: string) {
  const text = query.toLowerCase();
  const positiveWords = ['excellent', 'parfait', 'super', 'bon', 'bonne', 'genial', 'merci', 'satisfait', 'rapide', 'propre', 'accueillant', 'aime', 'adore'];
  const negativeWords = ['mauvais', 'nul', 'lent', 'lente', 'attente', 'retard', 'cher', 'sale', 'decu', 'probleme', 'plainte', 'impoli', 'froid', 'jamais', 'insatisfait', 'terrible', 'mecontent'];
  const positiveHits = positiveWords.filter((word) => text.includes(word)).length;
  const negativeHits = negativeWords.filter((word) => text.includes(word)).length;

  if (positiveHits > negativeHits) return 'positive';
  if (negativeHits > positiveHits) return 'negative';
  return null;
}

function buildSearchFilter(companyId: string, query: string, filters: Pick<ReviewSearchFilters, 'startDate' | 'endDate' | 'qrCodeId'> = {}) {
  const clauses = [`companyId:=${companyId}`];
  const sentiment = inferQuerySentiment(query);
  if (sentiment) clauses.push(`sentiment:=${sentiment}`);
  if (filters.qrCodeId) clauses.push(`qrCodeId:=${filters.qrCodeId}`);
  if (filters.startDate) clauses.push(`createdAt:>=${new Date(filters.startDate).getTime()}`);
  if (filters.endDate) {
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    clauses.push(`createdAt:<=${end.getTime()}`);
  }
  return clauses.join(' && ');
}

function buildReviewSearchFilter(companyId: string, filters: ReviewSearchFilters) {
  const clauses = [`companyId:=${companyId}`];
  if (filters.qrCodeId) clauses.push(`qrCodeId:=${filters.qrCodeId}`);
  if (filters.rating) clauses.push(`rating:=${filters.rating}`);
  if (filters.sentiment) clauses.push(`sentiment:=${filters.sentiment}`);
  if (filters.notificationStatus) clauses.push(`notificationStatus:=${filters.notificationStatus}`);
  if (filters.startDate) clauses.push(`createdAt:>=${new Date(filters.startDate).getTime()}`);
  if (filters.endDate) {
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    clauses.push(`createdAt:<=${end.getTime()}`);
  }
  return clauses.join(' && ');
}

export function mapReviewToSearchDocument(
  review: HydratedDocument<IReview> | (IReview & { createdAt?: Date; qrCode?: unknown }),
  qrCode?: HydratedDocument<ICompanyQrCode> | { _id?: unknown; label?: string }
): ReviewSearchDocument {
  const sentiment = inferSentiment(review);
  const answersText = (review.customAnswers || [])
    .map((answer) => `${answer.label}: ${stringifyAnswerValue(answer.value)}`)
    .filter(Boolean)
    .join('\n');
  const createdAt = review.createdAt instanceof Date ? review.createdAt : new Date();
  const resolvedQrCode = qrCode || (review.qrCode && typeof review.qrCode === 'object' ? review.qrCode as { _id?: unknown; label?: string } : undefined);

  return {
    id: String(review._id),
    companyId: String(review.company),
    qrCodeId: resolvedQrCode?._id ? String(resolvedQrCode._id) : undefined,
    qrCodeLabel: resolvedQrCode?.label || undefined,
    rating: review.rating,
    sentiment: sentiment.sentiment,
    sentimentScore: sentiment.sentimentScore,
    serviceFeedback: review.serviceFeedback || '',
    answersText,
    searchText: buildReviewText(review),
    notificationStatus: review.notificationStatus || 'pending',
    createdAt: createdAt.getTime()
  };
}

export async function indexReview(review: HydratedDocument<IReview>, qrCode?: HydratedDocument<ICompanyQrCode>) {
  if (!isTypesenseEnabled()) return;
  await ensureReviewsCollection();
  const document = mapReviewToSearchDocument(review, qrCode);
  await typesenseRequest(`/collections/${reviewsCollectionName}/documents?action=upsert`, {
    method: 'POST',
    body: JSON.stringify(document)
  });
}

export async function indexReviewQuietly(review: HydratedDocument<IReview>, qrCode?: HydratedDocument<ICompanyQrCode>) {
  indexReview(review, qrCode).catch((error) => {
    console.warn('[typesense:index-review:failed]', {
      reviewId: String(review._id),
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

export async function reindexCompanyReviews(company: HydratedDocument<ICompany>) {
  if (!isTypesenseEnabled()) return { indexed: 0, enabled: false };
  await ensureReviewsCollection();
  const reviews = await Review.find({ company: company._id }).populate('qrCode', 'label').sort({ createdAt: -1 });

  let indexed = 0;
  for (const review of reviews) {
    await indexReview(review);
    indexed += 1;
  }

  return { indexed, enabled: true };
}

export async function searchReviewsSemantically(companyId: string, query: string, page = 1, limit = 10, filters: Pick<ReviewSearchFilters, 'startDate' | 'endDate' | 'qrCodeId'> = {}) {
  if (!isTypesenseEnabled() || !query.trim()) return null;
  await ensureReviewsCollection();
  const normalizedQuery = query.trim();

  const response = await typesenseRequest<{ results: Array<TypesenseSearchResponse<ReviewSearchDocument>> }>('/multi_search', {
    method: 'POST',
    body: JSON.stringify({
      searches: [
        {
          collection: reviewsCollectionName,
          q: normalizedQuery,
          query_by: 'embedding,serviceFeedback,answersText',
          vector_query: `embedding:([], k: 100, alpha: 0.65, distance_threshold:${env.typesense.vectorDistanceThreshold})`,
          filter_by: buildSearchFilter(companyId, normalizedQuery, filters),
          exclude_fields: 'embedding',
          sort_by: '_text_match:desc,createdAt:desc',
          page,
          per_page: limit,
          drop_tokens_threshold: 0
        }
      ]
    })
  });

  const result = response.results[0] || {};
  return {
    total: result.found || 0,
    documents: (result.hits || []).map((hit) => ({
      ...hit.document,
      vectorDistance: hit.vector_distance
    }))
  };
}

export async function searchReviewsInTypesense(companyId: string, filters: ReviewSearchFilters, page = 1, limit = 10) {
  if (!isTypesenseEnabled()) return null;
  await ensureReviewsCollection();

  const query = String(filters.query || '').trim();
  const searchPayload = {
    q: query || '*',
    query_by: 'serviceFeedback,answersText,searchText',
    filter_by: buildReviewSearchFilter(companyId, filters),
    exclude_fields: 'embedding',
    sort_by: query ? '_text_match:desc,createdAt:desc' : 'createdAt:desc',
    page,
    per_page: limit,
    drop_tokens_threshold: 0
  };

  let response: TypesenseSearchResponse<ReviewSearchDocument>;
  try {
    response = await typesenseRequest<TypesenseSearchResponse<ReviewSearchDocument>>(`/collections/${reviewsCollectionName}/documents/search`, {
      method: 'POST',
      body: JSON.stringify(searchPayload)
    });
  } catch (error) {
    if (error instanceof TypesenseRequestError && error.status === 404) {
      markReviewsCollectionStale();
      await ensureReviewsCollection();
      await reindexCompanyReviewsById(companyId);
      response = await typesenseRequest<TypesenseSearchResponse<ReviewSearchDocument>>(`/collections/${reviewsCollectionName}/documents/search`, {
        method: 'POST',
        body: JSON.stringify(searchPayload)
      });
    } else {
      throw error;
    }
  }

  return {
    total: response.found || 0,
    ids: (response.hits || []).map((hit) => hit.document.id)
  };
}
