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

type SearchInput = PaginationInput & {
  query?: string;
  qrCodeId?: string;
  startDate?: string;
  endDate?: string;
};

type DateRangeInput = {
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
  impact: 'high' | 'medium' | 'low';
};

const topicRules: TopicRule[] = [
  { key: 'waiting_time', label: "Temps d'attente", impact: 'high', keywords: ['attente', 'attendre', 'lent', 'lente', 'retard', 'tard', 'patienter', 'longtemps'] },
  { key: 'customer_service', label: 'Accueil et service', impact: 'high', keywords: ['accueil', 'service', 'serveur', 'personnel', 'agent', 'impoli', 'désagréable', 'desagreable', 'froid', 'sourire'] },
  { key: 'price', label: 'Prix', impact: 'medium', keywords: ['prix', 'cher', 'coût', 'cout', 'tarif', 'facture'] },
  { key: 'quality', label: 'Qualité produit/service', impact: 'high', keywords: ['qualité', 'qualite', 'mauvais', 'bon', 'produit', 'repas', 'commande', 'déçu', 'decu'] },
  { key: 'cleanliness', label: 'Propreté', impact: 'medium', keywords: ['sale', 'propre', 'hygiène', 'hygiene', 'odeur', 'toilette'] },
  { key: 'payment', label: 'Paiement', impact: 'medium', keywords: ['paiement', 'payer', 'carte', 'mobile money', 'monnaie', 'transaction'] },
  { key: 'availability', label: 'Disponibilité', impact: 'medium', keywords: ['indisponible', 'rupture', 'disponible', 'stock', 'fermé', 'ferme'] }
];

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

function previousDateMatch(input: DateRangeInput = {}, dateField = 'createdAt') {
  const match: Record<string, unknown> = {};
  if (input.qrCodeId) match.qrCode = input.qrCodeId;
  if (!input.startDate || !input.endDate) return match;
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  end.setHours(23, 59, 59, 999);
  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  match[dateField] = { $gte: previousStart, $lte: previousEnd };
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

function matchTopic(text: string, rule: TopicRule) {
  const lower = text.toLowerCase();
  return rule.keywords.some((keyword) => lower.includes(keyword));
}

function buildSnippet(review: IReview) {
  const text = buildReviewText(review).replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function sentimentSummary(reviews: HydratedDocument<IReview>[]) {
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
    negativeRate: Math.round((summary.negative / total) * 100)
  };
}

function problemClusters(reviews: HydratedDocument<IReview>[]) {
  return topicRules
    .map((rule) => {
      const matched = reviews.filter((review) => matchTopic(buildReviewText(review), rule));
      const negativeCount = matched.filter((review) => inferSentiment(review).sentiment === 'negative' || review.rating <= 2).length;
      return {
        key: rule.key,
        label: rule.label,
        impact: rule.impact,
        count: matched.length,
        negativeCount,
        averageRating: matched.length
          ? Number((matched.reduce((sum, review) => sum + review.rating, 0) / matched.length).toFixed(2))
          : 0,
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

function urgentReviews(reviews: HydratedDocument<IReview>[]) {
  const urgentPattern = /\b(urgent|urgence|urgentissime|asap|immediat|immédiat|prioritaire)\b/i;
  return reviews
    .filter((review) => urgentPattern.test(buildReviewText(review)))
    .map((review) => ({
      id: String(review._id),
      rating: review.rating,
      createdAt: reviewDate(review).toISOString(),
      text: buildSnippet(review)
    }));
}

/** Full, quota-free analysis used by POST /api/analyse. */
export async function analyseReviews(company: HydratedDocument<ICompany>, input: DateRangeInput = {}) {
  const currentMatch = { company: company._id, moderationStatus: { $ne: 'archived' }, ...buildDateMatch(input) };
  const comparisonInput = input.comparisonStartDate && input.comparisonEndDate ? { ...input, startDate: input.comparisonStartDate, endDate: input.comparisonEndDate } : input;
  const previousMatch = { company: company._id, moderationStatus: { $ne: 'archived' }, ...(input.comparisonStartDate ? buildDateMatch(comparisonInput) : previousDateMatch(input)) };
  const [reviews, previousReviews, scanCount, previousScanCount] = await Promise.all([
    Review.find(currentMatch).populate('qrCode', 'label slug').sort({ createdAt: -1 }),
    Review.find(previousMatch).populate('qrCode', 'label slug').sort({ createdAt: -1 }),
    QrScan.countDocuments({ company: company._id, ...buildDateMatch(input, 'scannedAt') }),
    QrScan.countDocuments({ company: company._id, ...(input.comparisonStartDate ? buildDateMatch(comparisonInput, 'scannedAt') : previousDateMatch(input, 'scannedAt')) })
  ]);
  const trends = rangeTrendSummary(reviews, previousReviews);
  const topics = problemClusters(reviews);
  const sentiment = sentimentSummary(reviews);
  return {
    generatedAt: new Date().toISOString(),
    period: { startDate: input.startDate || null, endDate: input.endDate || null, qrCodeId: input.qrCodeId || null },
    comparisonPeriod: { startDate: input.comparisonStartDate || null, endDate: input.comparisonEndDate || null },
    reviews: { count: reviews.length, averageRating: trends.recentAverage, urgent: urgentReviews(reviews) },
    comparison: {
      previousReviewCount: previousReviews.length,
      reviewCountDelta: reviews.length - previousReviews.length,
      previousAverageRating: trends.previousAverage,
      averageRatingDelta: trends.averageDelta,
      previousScanCount,
      scanCountDelta: scanCount - previousScanCount
    },
    scans: { count: scanCount, conversionRate: conversionRate(reviews.length, scanCount) },
    topics,
    summary: trends.text,
    // Alias de compatibilite : l'ecran IA existant peut basculer sur cette
    // route sans perdre son contrat actuel.
    totalReviews: reviews.length,
    sentiment,
    trends,
    problems: topics
  };
}

type RecommendationPayload = {
  scans?: { conversionRate?: number; count?: number };
  comparison?: { averageRatingDelta?: number; reviewCountDelta?: number };
  reviews?: { urgent?: unknown[]; count?: number; averageRating?: number };
  topics?: Array<{ key?: string; label?: string; count?: number; negativeCount?: number; impact?: string }>;
};

/** Rule-based recommendations, intentionally separate from the free analysis route. */
export async function buildRecommendations(payload: RecommendationPayload) {
  const urgentCount = Array.isArray(payload.reviews?.urgent) ? payload.reviews!.urgent.length : 0;
  const ratingDelta = Number(payload.comparison?.averageRatingDelta || 0);
  const scanRate = Number(payload.scans?.conversionRate || 0);
  const topics = Array.isArray(payload.topics) ? payload.topics : [];

  const apiKey = (await readFileSecret('openaiApiKey')) || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'La clé OpenAI n’est pas configurée.');
  const context = { responseLanguage: env.openaiRecommendationsLanguage, metrics: { totalReviews: payload.reviews?.count || 0, averageRating: payload.reviews?.averageRating || 0, ratingDelta, satisfiedPercent: undefined, dissatisfiedPercent: undefined, scanRate }, urgentReviews: (payload.reviews?.urgent || []).slice(0, 5), recurringTopics: topics.slice(0, 3).map(({ label, count, negativeCount, impact }) => ({ label, count, negativeCount, impact })) };
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.openaiRecommendationsModel, input: [{ role: 'system', content: aiConfig.systemPrompt }, { role: 'user', content: JSON.stringify(context) }], text: { format: { type: 'json_schema', name: 'recommendations', strict: true, schema: aiConfig.responseSchema } } }) });
  if (!response.ok) throw new HttpError(502, 'La génération des recommandations IA a échoué.');
  const result = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const outputText = result.output_text || result.output
    ?.flatMap((item) => item.content || [])
    .find((content) => content.type === 'output_text' && typeof content.text === 'string')
    ?.text;
  if (!outputText) {
    console.error('[recommendations:openai:invalid-response]', { hasOutput: Boolean(result.output?.length) });
    throw new HttpError(502, 'Réponse IA invalide.');
  }
  let parsed: { recommendations?: unknown };
  try {
    parsed = JSON.parse(outputText) as { recommendations?: unknown };
  } catch {
    throw new HttpError(502, 'Réponse IA invalide.');
  }
  if (!Array.isArray(parsed.recommendations)) throw new HttpError(502, 'Réponse IA invalide.');
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

  if (semanticResult) {
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
