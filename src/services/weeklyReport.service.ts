import PDFDocument from 'pdfkit';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Review, type IReview } from '../models/Review.js';
import { QrScan } from '../models/QrScan.js';
import { problemClusters, sentimentSummary } from './reviewAnalytics.service.js';
import {
  palette,
  drawPageFrame,
  drawPill,
  drawBar,
  ensureSpace,
  drawKpiCard,
  drawSectionTitle,
  drawTopicRows,
  buildVerbatims,
  drawVerbatims
} from './pdfReportKit.js';

type TopicScore = ReturnType<typeof problemClusters>[number];

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

function averageRating(reviews: HydratedDocument<IReview>[]) {
  if (!reviews.length) return 0;
  return Number((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(2));
}

function conversionRate(reviewCount: number, scanCount: number) {
  return scanCount ? Number(((Math.min(reviewCount, scanCount) / scanCount) * 100).toFixed(2)) : 0;
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

function scanMatch(company: HydratedDocument<ICompany>, startDate: Date, endDate: Date) {
  return { company: company._id, scannedAt: { $gte: startDate, $lte: endDate } };
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
    const sentiment = sentimentSummary(qrReviews);
    analyses.push({
      label: qr?.label || qr?.slug || 'QR sans libellé',
      slug: qr?.slug || '',
      totalReviews: qrReviews.length,
      averageRating: averageRating(qrReviews),
      positiveRate: sentiment.positiveRate,
      neutralRate: sentiment.neutralRate,
      negativeRate: sentiment.negativeRate,
      problems: problemClusters(qrReviews).slice(0, 3),
    });
  }

  return analyses.sort((a, b) => b.totalReviews - a.totalReviews || b.averageRating - a.averageRating);
}

/** Rule-based suggestions (no AI model call) so the automatic weekly send never depends on OpenAI availability or quota. */
function buildRecommendations(analysis: GlobalAnalysis, ratingGoal: number) {
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
  if (analysis.averageRating < ratingGoal) {
    const gap = Number((ratingGoal - analysis.averageRating).toFixed(2));
    recommendations.push(`Objectif qualité : viser une note moyenne de ${ratingGoal}/5 (actuellement ${analysis.averageRating}/5, encore ${gap} point à gagner).`);
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

function isUnderperformingQr(qr: QrAnalysisResult) {
  return qr.totalReviews > 0 && (qr.averageRating <= 2.5 || qr.negativeRate >= 50);
}

function drawQrCards(doc: PDFKit.PDFDocument, qrAnalyses: QrAnalysisResult[]) {
  if (!qrAnalyses.length) {
    doc.fillColor(palette.muted).fontSize(9).text('Aucun avis rattaché à un QR code pendant cette période.', 62, doc.y, { width: 470 });
    doc.moveDown(0.8);
    return;
  }

  const shown = qrAnalyses.slice(0, 8);
  for (const qr of shown) {
    const alert = isUnderperformingQr(qr);
    ensureSpace(doc, 98);
    const y = doc.y;
    doc.roundedRect(56, y, 483, 86, 8).fillAndStroke(alert ? palette.dangerSoft : palette.white, alert ? palette.danger : palette.line);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(11).text(qr.label, 72, y + 13, { width: 250 });
    drawPill(doc, alert ? `⚠ ${qr.totalReviews} avis` : `${qr.totalReviews} avis`, 395, y + 10, alert ? palette.danger : palette.primaryDark, alert ? palette.white : palette.primarySoft);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(`Note moyenne : ${qr.averageRating}/5`, 72, y + 34, { width: 160 });
    doc.text(`Positif : ${qr.positiveRate}%`, 226, y + 34, { width: 100 });
    doc.text(`Négatif : ${qr.negativeRate}%`, 328, y + 34, { width: 100 });
    const topicText = qr.problems.length
      ? qr.problems.map((problem) => `${problem.label} (${problem.count})`).join(', ')
      : 'Aucun irritant récurrent';
    doc.fillColor(alert ? palette.danger : palette.ink).font(alert ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(alert ? `QR sous-performant - À surveiller : ${topicText}` : `À surveiller : ${topicText}`, 72, y + 58, { width: 420 });
    doc.y = y + 96;
  }

  const remaining = qrAnalyses.length - shown.length;
  if (remaining > 0) {
    ensureSpace(doc, 18);
    doc.fillColor(palette.muted).font('Helvetica-Oblique').fontSize(8).text(`+ ${remaining} autre(s) QR code(s) non affiché(s) ici.`, 62, doc.y, { width: 470 });
    doc.moveDown(0.6);
  }
}

export async function buildWeeklyReportPdf(
  company: HydratedDocument<ICompany>,
  weekRange: WeekRange,
): Promise<Buffer> {
  const startDate = new Date(weekRange.startDate);
  const endDate = new Date(weekRange.endDate);
  const { previousStart, previousEnd } = previousRange(weekRange);

  const [allReviews, previousReviews, scanCount, previousScanCount] = await Promise.all([
    Review.find(reviewMatch(company, startDate, endDate))
      .populate('qrCode', 'label slug')
      .sort({ createdAt: -1 }),
    Review.find(reviewMatch(company, previousStart, previousEnd)),
    QrScan.countDocuments(scanMatch(company, startDate, endDate)),
    QrScan.countDocuments(scanMatch(company, previousStart, previousEnd)),
  ]);

  const sentiment = sentimentSummary(allReviews);
  const previousAverageRating = averageRating(previousReviews);
  const globalAnalysis: GlobalAnalysis = {
    totalReviews: allReviews.length,
    previousTotalReviews: previousReviews.length,
    averageRating: averageRating(allReviews),
    previousAverageRating,
    positiveRate: sentiment.positiveRate,
    neutralRate: sentiment.neutralRate,
    negativeRate: sentiment.negativeRate,
    problems: problemClusters(allReviews).slice(0, 5),
  };
  const currentConversionRate = conversionRate(allReviews.length, scanCount);
  const previousConversionRate = conversionRate(previousReviews.length, previousScanCount);
  const qrAnalyses = buildQrAnalyses(allReviews);
  const recommendations = buildRecommendations(globalAnalysis, company.ratingGoal ?? 4.5);
  const verbatims = buildVerbatims(allReviews);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Bilan hebdomadaire Opinbase' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    drawPageFrame(doc);

    doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
    doc.fillColor(palette.ink).fontSize(24).text('Bilan hebdomadaire', 48, 84, { width: 340 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(10).text(`${company.name} - ${weekRange.startLabel} au ${weekRange.endLabel}`, 48, 116, { width: 420 });
    drawPill(doc, 'Rapport automatique', 416, 64, palette.primaryDark, palette.primarySoft);

    const kpiY = 154;
    const kpiWidth = 109;
    drawKpiCard(doc, 48, kpiY, kpiWidth, 'Avis collectés', String(globalAnalysis.totalReviews), deltaText(globalAnalysis.totalReviews, globalAnalysis.previousTotalReviews, ' vs sem. préc.'));
    drawKpiCard(doc, 171, kpiY, kpiWidth, 'Note moyenne', `${globalAnalysis.averageRating}/5`, deltaText(globalAnalysis.averageRating, globalAnalysis.previousAverageRating, ' pt'));
    drawKpiCard(doc, 294, kpiY, kpiWidth, 'Conversion', `${currentConversionRate}%`, deltaText(currentConversionRate, previousConversionRate, ' pt vs sem. préc.'));
    drawKpiCard(doc, 417, kpiY, kpiWidth, 'Avis positifs', `${globalAnalysis.positiveRate}%`, `${globalAnalysis.negativeRate}% négatifs`);

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

    drawSectionTitle(doc, 'Verbatims marquants de la semaine', 'Les avis les plus représentatifs, à lire en premier.');
    drawVerbatims(doc, verbatims, 'aucun commentaire correspondant cette semaine.');

    drawSectionTitle(doc, 'Sujets récurrents de la semaine', 'Détection automatique par mots-clés, alignée sur l’analyse en ligne.');
    drawTopicRows(doc, globalAnalysis.problems, { emptyMessage: 'Aucun sujet récurrent détecté cette semaine.' });

    drawSectionTitle(doc, 'Recommandations de la semaine', 'Suggestions automatiques basées sur vos indicateurs de la semaine.');
    for (const recommendation of recommendations) {
      ensureSpace(doc, 38);
      const y = doc.y;
      doc.roundedRect(56, y, 483, 34, 8).fillAndStroke(palette.primarySoft, '#99f6e4');
      doc.fillColor(palette.primaryDark).font('Helvetica-Bold').fontSize(8).text('ACTION', 72, y + 11, { width: 50 });
      doc.fillColor(palette.ink).font('Helvetica').fontSize(9).text(recommendation, 126, y + 9, { width: 390 });
      doc.y = y + 44;
    }

    doc.addPage();
    drawPageFrame(doc);
    doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
    doc.fillColor(palette.ink).fontSize(20).text('Performance par QR code', 48, 86, { width: 400 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text('Classement des points de collecte les plus actifs et leurs sujets récurrents.', 48, 116, { width: 460 });
    doc.y = 154;
    drawQrCards(doc, qrAnalyses);

    doc.fillColor(palette.muted).fontSize(8).text('Les avis archivés sont exclus du bilan. Les tendances sont calculées sur la semaine précédente.', 48, 782, { width: 499, align: 'center' });
    doc.end();
  });
}
