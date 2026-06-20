import PDFDocument from 'pdfkit';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Review, type IReview } from '../models/Review.js';
import { buildReviewText, inferSentiment } from './typesense.service.js';

type TopicScore = {
  label: string;
  count: number;
  averageRating: number;
};

type QrAnalysisResult = {
  label: string;
  slug: string;
  totalReviews: number;
  averageRating: number;
  positiveRate: number;
  neutralRate: number;
  negativeRate: number;
  problems: TopicScore[];
};

type GlobalAnalysis = {
  totalReviews: number;
  previousTotalReviews: number;
  averageRating: number;
  previousAverageRating: number;
  positiveRate: number;
  neutralRate: number;
  negativeRate: number;
  problems: TopicScore[];
};

type WeekRange = {
  startDate: string;
  endDate: string;
  startLabel: string;
  endLabel: string;
};

const topicRules = [
  { key: 'waiting_time', label: "Temps d'attente", keywords: ['attente', 'attendre', 'lent', 'lente', 'retard', 'tard', 'patienter', 'longtemps'] },
  { key: 'customer_service', label: 'Accueil et service', keywords: ['accueil', 'service', 'serveur', 'personnel', 'agent', 'impoli', 'desagreable', 'désagréable', 'froid', 'sourire'] },
  { key: 'price', label: 'Prix', keywords: ['prix', 'cher', 'coût', 'cout', 'tarif', 'facture'] },
  { key: 'quality', label: 'Qualité produit/service', keywords: ['qualité', 'qualite', 'mauvais', 'bon', 'produit', 'repas', 'commande', 'déçu', 'decu'] },
  { key: 'cleanliness', label: 'Propreté', keywords: ['sale', 'propre', 'hygiène', 'hygiene', 'odeur', 'toilette'] },
  { key: 'payment', label: 'Paiement', keywords: ['paiement', 'payer', 'carte', 'mobile money', 'monnaie', 'transaction'] },
  { key: 'availability', label: 'Disponibilité', keywords: ['indisponible', 'rupture', 'disponible', 'stock', 'fermé', 'ferme'] },
];

const palette = {
  primary: '#0f766e',
  primaryDark: '#115e59',
  primarySoft: '#ccfbf1',
  ink: '#102a43',
  muted: '#64748b',
  line: '#dbe3ee',
  panel: '#f8fafc',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  warning: '#d97706',
  warningSoft: '#fef3c7',
  white: '#ffffff',
};

function matchTopic(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function computeSentiment(reviews: HydratedDocument<IReview>[]) {
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const review of reviews) {
    const s = inferSentiment(review).sentiment;
    if (s === 'positive') positive++;
    else if (s === 'negative') negative++;
    else neutral++;
  }
  const total = reviews.length || 1;
  return {
    positive,
    negative,
    neutral,
    positiveRate: Math.round((positive / total) * 100),
    negativeRate: Math.round((negative / total) * 100),
    neutralRate: Math.round((neutral / total) * 100),
  };
}

function averageRating(reviews: HydratedDocument<IReview>[]) {
  if (!reviews.length) return 0;
  return Number((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(2));
}

function computeProblems(reviews: HydratedDocument<IReview>[]) {
  return topicRules
    .map((rule) => {
      const matched = reviews.filter((review) => matchTopic(buildReviewText(review), rule.keywords));
      return {
        label: rule.label,
        count: matched.length,
        averageRating: averageRating(matched),
      };
    })
    .filter((problem) => problem.count > 0)
    .sort((a, b) => b.count - a.count || a.averageRating - b.averageRating);
}

function previousRange(weekRange: WeekRange) {
  const start = new Date(weekRange.startDate);
  const end = new Date(weekRange.endDate);
  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  return { previousStart, previousEnd };
}

export function getLastWeekRange(): WeekRange {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - daysSinceMonday - 7);
  lastMonday.setHours(0, 0, 0, 0);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  lastSunday.setHours(23, 59, 59, 999);

  const formatDate = (date: Date) =>
    date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return {
    startDate: lastMonday.toISOString(),
    endDate: lastSunday.toISOString(),
    startLabel: formatDate(lastMonday),
    endLabel: formatDate(lastSunday),
  };
}

function reviewMatch(company: HydratedDocument<ICompany>, startDate: Date, endDate: Date) {
  return {
    company: company._id,
    moderationStatus: { $ne: 'archived' },
    createdAt: { $gte: startDate, $lte: endDate },
  };
}

function buildQrAnalyses(reviews: HydratedDocument<IReview>[]) {
  const qrMap = new Map<string, HydratedDocument<IReview>[]>();
  for (const review of reviews) {
    const qrId = review.qrCode ? String(review.qrCode._id) : '__none__';
    if (!qrMap.has(qrId)) qrMap.set(qrId, []);
    qrMap.get(qrId)!.push(review);
  }

  const analyses: QrAnalysisResult[] = [];
  for (const [qrId, qrReviews] of qrMap) {
    if (qrId === '__none__') continue;
    const qr = qrReviews[0].qrCode as unknown as { label?: string; slug?: string } | undefined;
    const sentiment = computeSentiment(qrReviews);
    analyses.push({
      label: qr?.label || qr?.slug || 'QR sans libellé',
      slug: qr?.slug || '',
      totalReviews: qrReviews.length,
      averageRating: averageRating(qrReviews),
      positiveRate: sentiment.positiveRate,
      neutralRate: sentiment.neutralRate,
      negativeRate: sentiment.negativeRate,
      problems: computeProblems(qrReviews).slice(0, 3),
    });
  }

  return analyses.sort((a, b) => b.totalReviews - a.totalReviews || b.averageRating - a.averageRating);
}

function buildRecommendations(analysis: GlobalAnalysis) {
  const recommendations: string[] = [];
  const mainProblem = analysis.problems[0];

  if (analysis.totalReviews === 0) {
    return [
      'Augmenter la collecte : placer les QR codes aux zones de passage et rappeler aux clients de laisser un avis.',
      'Tester au moins deux emplacements de QR code cette semaine pour identifier celui qui convertit le mieux.',
    ];
  }

  if (analysis.negativeRate >= 25) {
    recommendations.push('Traiter en priorité les avis négatifs : lire les derniers commentaires et archiver seulement après action.');
  }
  if (mainProblem) {
    recommendations.push(`Plan d'action prioritaire : ${mainProblem.label.toLowerCase()} revient dans ${mainProblem.count} avis.`);
  }
  if (analysis.averageRating < 3.8) {
    recommendations.push('Objectif qualité : viser une note moyenne supérieure à 4/5 sur la prochaine semaine.');
  }
  if (analysis.totalReviews < Math.max(5, analysis.previousTotalReviews)) {
    recommendations.push('Relancer la collecte : le volume d’avis est faible ou en recul par rapport à la semaine précédente.');
  }
  if (!recommendations.length) {
    recommendations.push('Maintenir le niveau actuel et demander aux équipes de noter les bonnes pratiques qui reviennent dans les avis positifs.');
  }

  return recommendations.slice(0, 4);
}

function deltaText(current: number, previous: number, suffix = '') {
  const delta = Number((current - previous).toFixed(2));
  if (delta === 0) return `stable${suffix}`;
  return `${delta > 0 ? '+' : ''}${delta}${suffix}`;
}

function drawPill(doc: PDFKit.PDFDocument, text: string, x: number, y: number, color: string, bg: string) {
  doc.roundedRect(x, y, 118, 22, 11).fillColor(bg).fill();
  doc.fillColor(color).fontSize(8).font('Helvetica-Bold').text(text, x + 10, y + 7, { width: 98, align: 'center' });
}

function drawBar(doc: PDFKit.PDFDocument, x: number, y: number, width: number, rate: number, color: string) {
  const safeRate = Math.max(0, Math.min(1, rate));
  doc.roundedRect(x, y, width, 8, 4).fillColor('#e2e8f0').fill();
  doc.roundedRect(x, y, width * safeRate, 8, 4).fillColor(color).fill();
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > 770) {
    doc.addPage();
    doc.y = 56;
  }
}

function drawKpiCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, title: string, value: string, detail: string) {
  doc.roundedRect(x, y, width, 78, 10).fillAndStroke(palette.white, palette.line);
  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), x + 14, y + 14, { width: width - 28 });
  doc.fillColor(palette.ink).fontSize(22).text(value, x + 14, y + 31, { width: width - 28 });
  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(detail, x + 14, y + 58, { width: width - 28 });
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  ensureSpace(doc, subtitle ? 52 : 34);
  doc.fillColor(palette.primaryDark).font('Helvetica-Bold').fontSize(14).text(title, 48, doc.y);
  if (subtitle) {
    doc.moveDown(0.25);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(subtitle, 48, doc.y, { width: 499 });
  }
  doc.moveDown(0.5);
}

function drawTopicRows(doc: PDFKit.PDFDocument, topics: TopicScore[]) {
  if (!topics.length) {
    doc.fillColor(palette.muted).fontSize(9).text('Aucun sujet récurrent détecté cette semaine.', 62, doc.y, { width: 470 });
    doc.moveDown(0.8);
    return;
  }

  for (const topic of topics.slice(0, 5)) {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.roundedRect(56, y, 483, 30, 6).fillAndStroke(palette.white, palette.line);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(9).text(topic.label, 70, y + 9, { width: 245 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`${topic.count} avis`, 320, y + 10, { width: 70 });
    drawBar(doc, 388, y + 12, 82, topic.averageRating / 5, topic.averageRating >= 4 ? palette.primary : palette.warning);
    doc.fillColor(palette.muted).fontSize(8).text(`${topic.averageRating}/5`, 478, y + 10, { width: 45, align: 'right' });
    doc.y = y + 38;
  }
}

function drawQrCards(doc: PDFKit.PDFDocument, qrAnalyses: QrAnalysisResult[]) {
  if (!qrAnalyses.length) {
    doc.fillColor(palette.muted).fontSize(9).text('Aucun avis rattaché à un QR code pendant cette période.', 62, doc.y, { width: 470 });
    doc.moveDown(0.8);
    return;
  }

  for (const qr of qrAnalyses.slice(0, 8)) {
    ensureSpace(doc, 98);
    const y = doc.y;
    doc.roundedRect(56, y, 483, 86, 8).fillAndStroke(palette.white, palette.line);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(11).text(qr.label, 72, y + 13, { width: 250 });
    drawPill(doc, `${qr.totalReviews} avis`, 395, y + 10, palette.primaryDark, palette.primarySoft);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(`Note moyenne : ${qr.averageRating}/5`, 72, y + 34, { width: 160 });
    doc.text(`Positif : ${qr.positiveRate}%`, 226, y + 34, { width: 100 });
    doc.text(`Négatif : ${qr.negativeRate}%`, 328, y + 34, { width: 100 });
    const topicText = qr.problems.length
      ? qr.problems.map((problem) => `${problem.label} (${problem.count})`).join(', ')
      : 'Aucun irritant récurrent';
    doc.fillColor(palette.ink).fontSize(8).text(`À surveiller : ${topicText}`, 72, y + 58, { width: 420 });
    doc.y = y + 96;
  }
}

export async function buildWeeklyReportPdf(
  company: HydratedDocument<ICompany>,
  weekRange: WeekRange,
): Promise<Buffer> {
  const startDate = new Date(weekRange.startDate);
  const endDate = new Date(weekRange.endDate);
  const { previousStart, previousEnd } = previousRange(weekRange);

  const [allReviews, previousReviews] = await Promise.all([
    Review.find(reviewMatch(company, startDate, endDate))
      .populate('qrCode', 'label slug')
      .sort({ createdAt: -1 }),
    Review.find(reviewMatch(company, previousStart, previousEnd)),
  ]);

  const sentiment = computeSentiment(allReviews);
  const previousAverageRating = averageRating(previousReviews);
  const globalAnalysis: GlobalAnalysis = {
    totalReviews: allReviews.length,
    previousTotalReviews: previousReviews.length,
    averageRating: averageRating(allReviews),
    previousAverageRating,
    positiveRate: sentiment.positiveRate,
    neutralRate: sentiment.neutralRate,
    negativeRate: sentiment.negativeRate,
    problems: computeProblems(allReviews).slice(0, 5),
  };
  const qrAnalyses = buildQrAnalyses(allReviews);
  const recommendations = buildRecommendations(globalAnalysis);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Bilan hebdomadaire QR Feedback' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, 595, 842).fillColor(palette.panel).fill();
    doc.roundedRect(34, 34, 527, 774, 18).fillAndStroke(palette.white, palette.line);

    doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
    doc.fillColor(palette.ink).fontSize(24).text('Bilan hebdomadaire', 48, 84, { width: 340 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(10).text(`${company.name} - ${weekRange.startLabel} au ${weekRange.endLabel}`, 48, 116, { width: 420 });
    drawPill(doc, 'Rapport automatique', 416, 64, palette.primaryDark, palette.primarySoft);

    const kpiY = 154;
    drawKpiCard(doc, 48, kpiY, 154, 'Avis collectés', String(globalAnalysis.totalReviews), deltaText(globalAnalysis.totalReviews, globalAnalysis.previousTotalReviews, ' vs semaine préc.'));
    drawKpiCard(doc, 220, kpiY, 154, 'Note moyenne', `${globalAnalysis.averageRating}/5`, deltaText(globalAnalysis.averageRating, globalAnalysis.previousAverageRating, ' pt'));
    drawKpiCard(doc, 392, kpiY, 154, 'Avis positifs', `${globalAnalysis.positiveRate}%`, `${globalAnalysis.negativeRate}% négatifs`);

    doc.y = 260;
    drawSectionTitle(doc, 'Lecture rapide', 'Les signaux importants à regarder avant de passer aux détails.');
    const sentimentY = doc.y;
    doc.roundedRect(56, sentimentY, 483, 76, 8).fillAndStroke(palette.panel, palette.line);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(10).text('Répartition des sentiments', 72, sentimentY + 14);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`Positif ${globalAnalysis.positiveRate}%`, 72, sentimentY + 38);
    drawBar(doc, 160, sentimentY + 41, 95, globalAnalysis.positiveRate / 100, palette.primary);
    doc.text(`Neutre ${globalAnalysis.neutralRate}%`, 270, sentimentY + 38);
    drawBar(doc, 344, sentimentY + 41, 65, globalAnalysis.neutralRate / 100, palette.warning);
    doc.text(`Négatif ${globalAnalysis.negativeRate}%`, 424, sentimentY + 38);
    drawBar(doc, 490, sentimentY + 41, 35, globalAnalysis.negativeRate / 100, palette.danger);
    doc.y = sentimentY + 96;

    drawSectionTitle(doc, 'Priorités détectées par l’analyse IA');
    drawTopicRows(doc, globalAnalysis.problems);

    drawSectionTitle(doc, 'Recommandations de la semaine');
    for (const recommendation of recommendations) {
      ensureSpace(doc, 38);
      const y = doc.y;
      doc.roundedRect(56, y, 483, 34, 8).fillAndStroke(palette.primarySoft, '#99f6e4');
      doc.fillColor(palette.primaryDark).font('Helvetica-Bold').fontSize(8).text('ACTION', 72, y + 11, { width: 50 });
      doc.fillColor(palette.ink).font('Helvetica').fontSize(9).text(recommendation, 126, y + 9, { width: 390 });
      doc.y = y + 44;
    }

    doc.addPage();
    doc.rect(0, 0, 595, 842).fillColor(palette.panel).fill();
    doc.roundedRect(34, 34, 527, 774, 18).fillAndStroke(palette.white, palette.line);
    doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
    doc.fillColor(palette.ink).fontSize(20).text('Performance par QR code', 48, 86, { width: 400 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text('Classement des points de collecte les plus actifs et leurs sujets récurrents.', 48, 116, { width: 460 });
    doc.y = 154;
    drawQrCards(doc, qrAnalyses);

    doc.fillColor(palette.muted).fontSize(8).text('Les avis archivés sont exclus du bilan. Les tendances sont calculées sur la semaine précédente.', 48, 782, { width: 499, align: 'center' });
    doc.end();
  });
}
