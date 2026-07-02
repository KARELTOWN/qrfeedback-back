import { createHash } from 'node:crypto';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Review, type IReview } from '../models/Review.js';
import { QrScan } from '../models/QrScan.js';
import { env } from '../config/env.js';
import aiConfig from '../config/recommendations-ai.json' with { type: 'json' };
import { readFileSecret } from './fileSecret.service.js';
import { HttpError } from '../utils/httpError.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { buildReviewText, inferSentiment, reindexCompanyReviews, searchReviewsSemantically } from './typesense.service.js';
import { callOpenAiJsonSchema } from './openaiClient.service.js';
import { getCachedRecommendations, setCachedRecommendations } from './recommendationCache.service.js';

type SearchInput = PaginationInput & {
  query?: string;
  qrCodeId?: string;
  startDate?: string;
  endDate?: string;
};

export type DateRangeInput = {
  qrCodeId?: string;
  startDate?: string;
  endDate?: string;
  comparisonStartDate?: string;
  comparisonEndDate?: string;
};

type TopicRule = {
  key: string;
  label: string;
  keywords: string[];
};

// Keywords are written without accents — matchTopic() strips accents from the review text
// before comparing, so a single unaccented entry catches both "déçu" and "decu".
const topicRules: TopicRule[] = [
  { key: 'waiting_time', label: "Temps d'attente", keywords: ['attente', 'attendre', 'attends', 'lent', 'lente', 'lenteur', 'retard', 'tard', 'patienter', 'longtemps', 'file', 'queue', 'interminable', 'traine', 'trainer'] },
  { key: 'customer_service', label: 'Accueil et service', keywords: ['accueil', 'accueillant', 'service', 'serveur', 'serveuse', 'personnel', 'agent', 'vendeur', 'vendeuse', 'caissier', 'caissiere', 'hote', 'hotesse', 'impoli', 'malpoli', 'desagreable', 'froid', 'sourire', 'aimable', 'courtois', 'gentil', 'arrogant', 'rude', 'antipathique'] },
  { key: 'price', label: 'Prix', keywords: ['prix', 'cher', 'cout', 'tarif', 'facture', 'couteux', 'onereux', 'abordable', 'reduction', 'promo', 'augmentation'] },
  { key: 'quality', label: 'Qualité produit/service', keywords: ['qualite', 'mauvais', 'bon', 'bonne', 'produit', 'repas', 'commande', 'decu', 'gout', 'savoureux', 'fraicheur', 'frais', 'plat', 'cuisine', 'texture'] },
  { key: 'cleanliness', label: 'Propreté', keywords: ['sale', 'propre', 'proprete', 'hygiene', 'odeur', 'toilette', 'poussiere', 'crasse', 'nettoyage', 'desinfection'] },
  { key: 'payment', label: 'Paiement', keywords: ['paiement', 'payer', 'carte', 'mobile money', 'monnaie', 'transaction', 'especes', 'cash', 'recu', 'caisse'] },
  // 'manque'/'complet' dropped: 'complet' is a substring of the common filler word "complètement"
  // and matched 97% of all reviews in production data — same trap as 'email' below.
  { key: 'availability', label: 'Disponibilité', keywords: ['indisponible', 'rupture', 'disponible', 'stock', 'ferme', 'epuise', 'horaires', 'ouverture'] },
  { key: 'delivery', label: 'Livraison', keywords: ['livreur', 'livraison', 'livrer', 'colis', 'expedition', 'delai de livraison'] },
  { key: 'ambiance', label: 'Ambiance', keywords: ['ambiance', 'bruit', 'bruyant', 'musique', 'decor', 'deco', 'decoration', 'calme', 'confortable', 'lumiere'] },
  // 'email' dropped: every review with an email contact answer embeds the literal field
  // label "Email: ..." in its searchable text, so it matched 97% of reviews regardless of content.
  // 'sav'/'suivi'/'reponse' dropped: too short or too close to boilerplate closing phrases ("soit suivi
  // dans les prochains jours") seeded across unrelated reviews — replaced with specific complaint phrasing.
  { key: 'communication', label: 'Communication / SAV', keywords: ['repondu', 'contact', 'joindre', 'rappeler', 'reclamation', 'plainte', 'sans reponse', 'pas de reponse', 'sans nouvelle', 'pas de retour'] }
];

// Impact reflects how badly this topic is currently performing for THIS period's reviews,
// not a fixed property of the keyword category — a topic full of positive mentions should never read as urgent.
function computeTopicImpact(count: number, negativeCount: number, averageRating: number): 'high' | 'medium' | 'low' {
  if (!count) return 'low';
  const negativeRate = negativeCount / count;
  if (negativeRate >= 0.5 || averageRating <= 2.2) return 'high';
  if (negativeRate >= 0.25 || averageRating <= 3.3) return 'medium';
  return 'low';
}

function reviewDate(review: IReview & { createdAt?: Date }) {
  return review.createdAt instanceof Date ? review.createdAt : new Date();
}

function buildDateMatch(input: DateRangeInput = {}, dateField = 'createdAt') {
  const match: Record<string, unknown> = {};
  if (input.qrCodeId) match.qrCode = input.qrCodeId;
  const createdAt: Record<string, Date> = {};
  if (input.startDate) createdAt.$gte = new Date(input.startDate);
  if (input.endDate) {
    const end = new Date(input.endDate);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) match[dateField] = createdAt;
  return match;
}

function computePreviousRange(input: DateRangeInput = {}) {
  if (!input.startDate || !input.endDate) return null;
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  end.setHours(23, 59, 59, 999);
  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  return { start: previousStart, end: previousEnd };
}

function previousDateMatch(input: DateRangeInput = {}, dateField = 'createdAt') {
  const match: Record<string, unknown> = {};
  if (input.qrCodeId) match.qrCode = input.qrCodeId;
  const range = computePreviousRange(input);
  if (range) match[dateField] = { $gte: range.start, $lte: range.end };
  return match;
}

function toPlainReview(review: HydratedDocument<IReview>) {
  return {
    _id: review._id,
    createdAt: review.createdAt,
    rating: review.rating,
    serviceFeedback: review.serviceFeedback,
    customAnswers: review.customAnswers,
    notificationStatus: review.notificationStatus,
    qrCode: review.qrCode
  };
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function matchTopic(text: string, rule: TopicRule) {
  const normalized = normalizeText(text);
  return rule.keywords.some((keyword) => normalized.includes(keyword));
}

function buildSnippet(review: IReview) {
  const text = buildReviewText(review).replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

export function sentimentSummary(reviews: HydratedDocument<IReview>[]) {
  const summary = { positive: 0, neutral: 0, negative: 0 };
  let scoreTotal = 0;

  for (const review of reviews) {
    const sentiment = inferSentiment(review);
    summary[sentiment.sentiment] += 1;
    scoreTotal += sentiment.sentimentScore;
  }

  const total = reviews.length || 1;
  return {
    ...summary,
    averageScore: Number((scoreTotal / total).toFixed(2)),
    positiveRate: Math.round((summary.positive / total) * 100),
    negativeRate: Math.round((summary.negative / total) * 100),
    neutralRate: Math.round((summary.neutral / total) * 100)
  };
}

export function problemClusters(reviews: HydratedDocument<IReview>[]) {
  return topicRules
    .map((rule) => {
      const matched = reviews.filter((review) => matchTopic(buildReviewText(review), rule));
      const negativeCount = matched.filter((review) => inferSentiment(review).sentiment === 'negative' || review.rating <= 2).length;
      const averageRating = matched.length
        ? Number((matched.reduce((sum, review) => sum + review.rating, 0) / matched.length).toFixed(2))
        : 0;
      return {
        key: rule.key,
        label: rule.label,
        impact: computeTopicImpact(matched.length, negativeCount, averageRating),
        count: matched.length,
        negativeCount,
        averageRating,
        examples: matched.slice(0, 3).map((review) => ({
          id: String(review._id),
          rating: review.rating,
          createdAt: reviewDate(review).toISOString(),
          text: buildSnippet(review)
        }))
      };
    })
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.negativeCount - a.negativeCount || b.count - a.count);
}

function trendSummary(reviews: HydratedDocument<IReview>[]) {
  const now = new Date();
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 30);
  const previousStart = new Date(now);
  previousStart.setDate(previousStart.getDate() - 60);

  const recent = reviews.filter((review) => reviewDate(review) >= recentStart);
  const previous = reviews.filter((review) => reviewDate(review) >= previousStart && reviewDate(review) < recentStart);
  const avg = (items: HydratedDocument<IReview>[]) => items.length ? items.reduce((sum, review) => sum + review.rating, 0) / items.length : 0;
  const recentAverage = avg(recent);
  const previousAverage = avg(previous);
  const delta = Number((recentAverage - previousAverage).toFixed(2));
  const clusters = problemClusters(recent.length ? recent : reviews);
  const topProblem = clusters[0];
  const sentiment = sentimentSummary(recent.length ? recent : reviews);

  const lines = [];
  if (!reviews.length) {
    lines.push('Aucun avis disponible pour générer une tendance.');
  } else if (!recent.length) {
    lines.push('Aucun nouvel avis sur les 30 derniers jours, analyse basée sur l historique disponible.');
  } else {
    lines.push(`${recent.length} avis sur les 30 derniers jours, avec une note moyenne de ${recentAverage.toFixed(2)}/5.`);
  }

  if (previous.length) {
    const direction = delta > 0 ? 'en hausse' : delta < 0 ? 'en baisse' : 'stable';
    lines.push(`La note moyenne est ${direction} de ${Math.abs(delta).toFixed(2)} point par rapport aux 30 jours précédents.`);
  }

  if (topProblem) {
    lines.push(`Le sujet le plus fréquent est "${topProblem.label}", présent dans ${topProblem.count} avis.`);
  }

  lines.push(`Le sentiment global est ${sentiment.negativeRate}% négatif et ${sentiment.positiveRate}% positif.`);

  return {
    text: lines.join(' '),
    recentCount: recent.length,
    previousCount: previous.length,
    recentAverage: Number(recentAverage.toFixed(2)),
    previousAverage: Number(previousAverage.toFixed(2)),
    averageDelta: delta
  };
}

function lexicalScore(query: string, review: HydratedDocument<IReview>) {
  const queryWords = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const text = buildReviewText(review).toLowerCase();
  return queryWords.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
}

function rangeTrendSummary(reviews: HydratedDocument<IReview>[], previous: HydratedDocument<IReview>[] = []) {
  const avg = (items: HydratedDocument<IReview>[]) => items.length ? items.reduce((sum, review) => sum + review.rating, 0) / items.length : 0;
  const currentAverage = avg(reviews);
  const previousAverage = avg(previous);
  const delta = Number((currentAverage - previousAverage).toFixed(2));
  const clusters = problemClusters(reviews);
  const topProblem = clusters[0];

  const lines = [];
  if (!reviews.length) {
    lines.push('Aucun avis disponible pour la période sélectionnée.');
  } else {
    lines.push(`${reviews.length} avis analysé${reviews.length > 1 ? 's' : ''} sur la période, pour une note moyenne de ${currentAverage.toFixed(2)}/5.`);
  }

  if (previous.length) {
    const direction = delta > 0 ? 'en hausse' : delta < 0 ? 'en baisse' : 'stable';
    lines.push(`Par rapport à la période précédente équivalente, la note est ${direction} de ${Math.abs(delta).toFixed(2)} point.`);
  }

  if (topProblem) {
    lines.push(`Le sujet le plus mentionné est "${topProblem.label}", retrouvé dans ${topProblem.count} avis.`);
  }

  return {
    text: lines.join(' '),
    recentCount: reviews.length,
    previousCount: previous.length,
    recentAverage: Number(currentAverage.toFixed(2)),
    previousAverage: Number(previousAverage.toFixed(2)),
    averageDelta: delta
  };
}

export async function getAiOverview(company: HydratedDocument<ICompany>, input: DateRangeInput = {}) {
  const [reviews, previousReviews] = await Promise.all([
    Review.find({ company: company._id, ...buildDateMatch(input) })
      .populate('qrCode', 'label slug')
      .sort({ createdAt: -1 }),
    Review.find({ company: company._id, ...previousDateMatch(input) })
      .populate('qrCode', 'label slug')
      .sort({ createdAt: -1 })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    totalReviews: reviews.length,
    sentiment: sentimentSummary(reviews),
    trends: rangeTrendSummary(reviews, previousReviews),
    problems: problemClusters(reviews)
  };
}

function conversionRate(reviewCount: number, scanCount: number) {
  return scanCount ? Number(((Math.min(reviewCount, scanCount) / scanCount) * 100).toFixed(2)) : 0;
}

export function isUrgentReview(review: HydratedDocument<IReview>) {
  const urgentPattern = /\b(urgent|urgence|urgentissime|asap|immediat|immédiat|prioritaire)\b/i;
  if (urgentPattern.test(buildReviewText(review))) return true;
  if (review.rating <= 1) return true;
  const sentiment = inferSentiment(review);
  return sentiment.sentiment === 'negative' && sentiment.sentimentScore <= -1;
}

function urgentReviews(reviews: HydratedDocument<IReview>[]) {
  return reviews
    .filter(isUrgentReview)
    .map((review) => ({
      id: String(review._id),
      rating: review.rating,
      createdAt: reviewDate(review).toISOString(),
      text: buildSnippet(review)
    }));
}

/** Buckets reviews into up to 6 equal sub-periods to chart sentiment evolution over the selected range. */
function sentimentTrendBuckets(reviews: HydratedDocument<IReview>[], input: DateRangeInput) {
  if (!input.startDate || !input.endDate) return [];
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  end.setHours(23, 59, 59, 999);
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return [];

  const bucketCount = Math.min(6, Math.max(2, Math.ceil(totalMs / (7 * 24 * 60 * 60 * 1000))));
  const bucketMs = totalMs / bucketCount;

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + index * bucketMs);
    const bucketEnd = new Date(start.getTime() + (index + 1) * bucketMs);
    const bucketReviews = reviews.filter((review) => {
      const time = reviewDate(review).getTime();
      return time >= bucketStart.getTime() && time < bucketEnd.getTime();
    });
    const summary = sentimentSummary(bucketReviews);
    return {
      startDate: bucketStart.toISOString(),
      endDate: bucketEnd.toISOString(),
      count: bucketReviews.length,
      positiveRate: summary.positiveRate,
      neutralRate: summary.neutralRate,
      negativeRate: summary.negativeRate
    };
  });
}

/** Full, quota-free analysis used by POST /api/analyse. */
export async function analyseReviews(company: HydratedDocument<ICompany>, input: DateRangeInput = {}) {
  const currentMatch = { company: company._id, moderationStatus: { $ne: 'archived' }, ...buildDateMatch(input) };
  const hasCustomComparison = Boolean(input.comparisonStartDate && input.comparisonEndDate);
  const comparisonInput = hasCustomComparison ? { ...input, startDate: input.comparisonStartDate, endDate: input.comparisonEndDate } : input;
  const previousMatch = { company: company._id, moderationStatus: { $ne: 'archived' }, ...(hasCustomComparison ? buildDateMatch(comparisonInput) : previousDateMatch(input)) };
  const previousRange = hasCustomComparison
    ? { start: new Date(input.comparisonStartDate!), end: new Date(input.comparisonEndDate!) }
    : computePreviousRange(input);
  const [reviews, previousReviews, scanCount, previousScanCount] = await Promise.all([
    Review.find(currentMatch).populate('qrCode', 'label slug').sort({ createdAt: -1 }),
    Review.find(previousMatch).populate('qrCode', 'label slug').sort({ createdAt: -1 }),
    QrScan.countDocuments({ company: company._id, ...buildDateMatch(input, 'scannedAt') }),
    QrScan.countDocuments({ company: company._id, ...(hasCustomComparison ? buildDateMatch(comparisonInput, 'scannedAt') : previousDateMatch(input, 'scannedAt')) })
  ]);
  const trends = rangeTrendSummary(reviews, previousReviews);
  const topics = problemClusters(reviews);
  const sentiment = sentimentSummary(reviews);
  const sentimentTrend = sentimentTrendBuckets(reviews, input);
  return {
    generatedAt: new Date().toISOString(),
    period: { startDate: input.startDate || null, endDate: input.endDate || null, qrCodeId: input.qrCodeId || null },
    comparisonPeriod: {
      startDate: previousRange ? previousRange.start.toISOString() : null,
      endDate: previousRange ? previousRange.end.toISOString() : null,
      isCustom: hasCustomComparison
    },
    reviews: { count: reviews.length, averageRating: trends.recentAverage, urgent: urgentReviews(reviews) },
    comparison: {
      previousReviewCount: previousReviews.length,
      reviewCountDelta: reviews.length - previousReviews.length,
      previousAverageRating: trends.previousAverage,
      averageRatingDelta: trends.averageDelta,
      previousScanCount,
      scanCountDelta: scanCount - previousScanCount,
      previousConversionRate: conversionRate(previousReviews.length, previousScanCount)
    },
    scans: { count: scanCount, conversionRate: conversionRate(reviews.length, scanCount) },
    topics,
    summary: trends.text,
    // Alias de compatibilite : l'ecran IA existant peut basculer sur cette
    // route sans perdre son contrat actuel.
    totalReviews: reviews.length,
    sentiment,
    sentimentTrend,
    trends,
    problems: topics
  };
}

/** Raw reviews for a period, for callers (e.g. PDF export) that need the underlying documents rather than aggregates. */
export async function getReviewsForPeriod(company: HydratedDocument<ICompany>, input: DateRangeInput = {}) {
  const match = { company: company._id, moderationStatus: { $ne: 'archived' }, ...buildDateMatch(input) };
  return Review.find(match).populate('qrCode', 'label slug').sort({ createdAt: -1 });
}

/**
 * Reviews matched to a topic, using the exact same keyword rule as problemClusters().
 * Lets the UI "click a topic" pivot show the real reviews behind its count, instead of
 * re-deriving an approximation through free-text search (which only matches the topic's
 * label words, not its full keyword list, and can disagree with the cluster count).
 */
export async function getReviewsForTopic(company: HydratedDocument<ICompany>, topicKey: string, input: SearchInput = {}) {
  const rule = topicRules.find((item) => item.key === topicKey);
  if (!rule) throw new HttpError(404, 'Sujet inconnu.');

  const pagination = normalizePagination(input);
  const reviews = await getReviewsForPeriod(company, input);
  const matched = reviews.filter((review) => matchTopic(buildReviewText(review), rule));
  const pageItems = matched.slice(pagination.skip, pagination.skip + pagination.limit).map(toPlainReview);

  return {
    reviews: pageItems,
    pagination: buildPagination(matched.length, pagination.page, pagination.limit),
    engine: 'topic' as const,
    topicLabel: rule.label
  };
}

type RecommendationPayload = {
  scans?: { conversionRate?: number; count?: number };
  comparison?: { averageRatingDelta?: number; reviewCountDelta?: number };
  reviews?: { urgent?: unknown[]; count?: number; averageRating?: number };
  topics?: Array<{ key?: string; label?: string; count?: number; negativeCount?: number; impact?: string }>;
};

/**
 * AI-generated recommendations for POST /api/recommandations.
 * `payload` must come from server-computed analytics (see analyseReviews), never from raw client input,
 * since its contents are forwarded into the OpenAI prompt.
 */
export async function buildRecommendations(companyId: string, payload: RecommendationPayload) {
  const ratingDelta = Number(payload.comparison?.averageRatingDelta || 0);
  const scanRate = Number(payload.scans?.conversionRate || 0);
  const topics = Array.isArray(payload.topics) ? payload.topics : [];

  const apiKey = (await readFileSecret('openaiApiKey')) || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'La clé OpenAI n’est pas configurée.');

  const context = {
    responseLanguage: env.openaiRecommendationsLanguage,
    metrics: { totalReviews: payload.reviews?.count || 0, averageRating: payload.reviews?.averageRating || 0, ratingDelta, scanRate },
    urgentReviews: (payload.reviews?.urgent || []).slice(0, 5),
    recurringTopics: topics.slice(0, 3).map(({ label, count, negativeCount, impact }) => ({ label, count, negativeCount, impact }))
  };

  const cacheKey = createHash('sha256').update(`${companyId}:${JSON.stringify(context)}`).digest('hex');
  const cached = getCachedRecommendations<unknown[]>(cacheKey);
  if (cached) return cached;

  const { outputText, usage } = await callOpenAiJsonSchema({
    apiKey,
    model: env.openaiRecommendationsModel,
    systemPrompt: aiConfig.systemPrompt,
    userContent: JSON.stringify(context),
    schemaName: 'recommendations',
    schema: aiConfig.responseSchema
  });
  console.log('[recommendations:openai:usage]', { companyId, model: env.openaiRecommendationsModel, usage });

  let parsed: { recommendations?: unknown };
  try {
    parsed = JSON.parse(outputText) as { recommendations?: unknown };
  } catch {
    throw new HttpError(502, 'Réponse IA invalide.');
  }
  if (!Array.isArray(parsed.recommendations)) throw new HttpError(502, 'Réponse IA invalide.');

  setCachedRecommendations(cacheKey, parsed.recommendations);
  return parsed.recommendations;
}

export async function searchAiReviews(company: HydratedDocument<ICompany>, input: SearchInput = {}) {
  const query = String(input.query || '').trim();
  const pagination = normalizePagination(input);

  if (!query) {
    return { reviews: [], pagination: buildPagination(0, pagination.page, pagination.limit), engine: 'none' };
  }

  const semanticResult = await searchReviewsSemantically(String(company._id), query, pagination.page, pagination.limit, {
    qrCodeId: input.qrCodeId,
    startDate: input.startDate,
    endDate: input.endDate
  }).catch((error) => {
    console.warn('[typesense:semantic-search:failed]', {
      companyId: String(company._id),
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });

  // Only trust the semantic engine's verdict when it actually found something; an empty result
  // (e.g. a short category-like query whose embedding sits outside the distance threshold) should
  // fall back to plain substring matching rather than report "no results" outright.
  if (semanticResult && semanticResult.total > 0) {
    const ids = semanticResult.documents.map((document) => document.id);
    const reviews = await Review.find({ _id: { $in: ids }, company: company._id, ...buildDateMatch(input) })
      .populate('qrCode', 'label slug');
    const byId = new Map(reviews.map((review) => [String(review._id), review]));

    return {
      reviews: ids.map((id) => byId.get(id)).filter(Boolean).map((review) => toPlainReview(review as HydratedDocument<IReview>)),
      pagination: buildPagination(semanticResult.total, pagination.page, pagination.limit),
      engine: 'typesense'
    };
  }

  const allReviews = await Review.find({ company: company._id, ...buildDateMatch(input) })
    .populate('qrCode', 'label slug')
    .sort({ createdAt: -1 });
  const matches = allReviews
    .map((review) => ({ review, score: lexicalScore(query, review) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(reviewDate(b.review)) - Number(reviewDate(a.review)));
  const pageItems = matches.slice(pagination.skip, pagination.skip + pagination.limit).map((item) => toPlainReview(item.review));

  return {
    reviews: pageItems,
    pagination: buildPagination(matches.length, pagination.page, pagination.limit),
    engine: 'mongo-fallback'
  };
}

export async function rebuildAiIndex(company: HydratedDocument<ICompany>) {
  return reindexCompanyReviews(company);
}
