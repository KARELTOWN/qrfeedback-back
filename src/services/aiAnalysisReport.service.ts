import PDFDocument from 'pdfkit';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import type { IReview } from '../models/Review.js';
import { analyseReviews, getReviewsForPeriod, type DateRangeInput } from './reviewAnalytics.service.js';
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
  drawVerbatims,
  truncateQuote
} from './pdfReportKit.js';

type AiAnalysis = ReturnType<typeof analyseReviews> extends Promise<infer T> ? T : never;

export type ExportRecommendation = { priority?: string; title?: string; action?: string; reason?: string };

function formatDateLabel(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function deltaText(current: number, previous: number, suffix = '') {
  const delta = Number((current - previous).toFixed(2));
  if (delta === 0) return `stable${suffix}`;
  return `${delta > 0 ? '+' : ''}${delta}${suffix}`;
}

function recommendationAccent(priority?: string) {
  if (priority === 'high') return palette.danger;
  if (priority === 'medium') return palette.warning;
  return palette.primary;
}

function drawRecommendationCard(doc: PDFKit.PDFDocument, index: number, item: ExportRecommendation) {
  ensureSpace(doc, 64);
  const y = doc.y;
  doc.roundedRect(56, y, 483, 54, 8).fillAndStroke(palette.white, palette.line);
  doc.roundedRect(56, y, 5, 54, 3).fillColor(recommendationAccent(item.priority)).fill();
  doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(9).text(`${index + 1}. ${item.title || 'Recommandation'}`, 72, y + 9, { width: 440 });
  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(truncateQuote(item.action || '', 150), 72, y + 26, { width: 440 });
  doc.y = y + 64;
}

/** Builds an on-demand PDF export of the live /ai analysis screen for the given period. */
export async function buildAiAnalysisPdf(
  company: HydratedDocument<ICompany>,
  input: DateRangeInput,
  recommendations: ExportRecommendation[] | null
): Promise<Buffer> {
  const [analysis, reviews] = await Promise.all([
    analyseReviews(company, input),
    getReviewsForPeriod(company, input)
  ]) as [AiAnalysis, HydratedDocument<IReview>[]];

  const verbatims = buildVerbatims(reviews);
  const periodLabel = formatDateLabel(analysis.period.startDate) && formatDateLabel(analysis.period.endDate)
    ? `${formatDateLabel(analysis.period.startDate)} au ${formatDateLabel(analysis.period.endDate)}`
    : 'Période sélectionnée';
  const comparisonLabel = formatDateLabel(analysis.comparisonPeriod.startDate) && formatDateLabel(analysis.comparisonPeriod.endDate)
    ? `${formatDateLabel(analysis.comparisonPeriod.startDate)} au ${formatDateLabel(analysis.comparisonPeriod.endDate)}`
    : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Analyse IA QR Feedback' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    drawPageFrame(doc);

    doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
    doc.fillColor(palette.ink).fontSize(24).text('Analyse IA', 48, 84, { width: 340 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(10).text(`${company.name} - ${periodLabel}`, 48, 116, { width: 420 });
    drawPill(doc, 'Export à la demande', 416, 64, palette.primaryDark, palette.primarySoft);

    const kpiY = 154;
    const kpiWidth = 109;
    drawKpiCard(doc, 48, kpiY, kpiWidth, 'Avis analysés', String(analysis.totalReviews), deltaText(analysis.totalReviews, analysis.comparison.previousReviewCount, ' vs période préc.'));
    drawKpiCard(doc, 171, kpiY, kpiWidth, 'Note moyenne', `${analysis.trends.recentAverage}/5`, deltaText(analysis.trends.recentAverage, analysis.comparison.previousAverageRating, ' pt'));
    drawKpiCard(doc, 294, kpiY, kpiWidth, 'Conversion', `${analysis.scans.conversionRate}%`, deltaText(analysis.scans.conversionRate, analysis.comparison.previousConversionRate, ' pt vs période préc.'));
    drawKpiCard(doc, 417, kpiY, kpiWidth, 'Avis positifs', `${analysis.sentiment.positiveRate}%`, `${analysis.sentiment.negativeRate}% négatifs`);

    doc.y = 260;
    drawSectionTitle(doc, 'Lecture rapide', 'Les signaux importants à regarder avant de passer aux détails.');
    const sentimentY = doc.y;
    doc.roundedRect(56, sentimentY, 483, 76, 8).fillAndStroke(palette.panel, palette.line);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(10).text('Répartition des sentiments', 72, sentimentY + 14);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`Positif ${analysis.sentiment.positiveRate}%`, 72, sentimentY + 38);
    drawBar(doc, 160, sentimentY + 41, 95, analysis.sentiment.positiveRate / 100, palette.primary);
    doc.text(`Neutre ${analysis.sentiment.neutralRate}%`, 270, sentimentY + 38);
    drawBar(doc, 344, sentimentY + 41, 65, analysis.sentiment.neutralRate / 100, palette.warning);
    doc.text(`Négatif ${analysis.sentiment.negativeRate}%`, 424, sentimentY + 38);
    drawBar(doc, 490, sentimentY + 41, 35, analysis.sentiment.negativeRate / 100, palette.danger);
    doc.y = sentimentY + 96;

    if (comparisonLabel) {
      drawSectionTitle(doc, 'Comparaison de périodes', analysis.comparisonPeriod.isCustom ? 'Comparaison personnalisée.' : 'Période équivalente précédente, calculée automatiquement.');
      const compareY = doc.y;
      doc.roundedRect(56, compareY, 483, 56, 8).fillAndStroke(palette.panel, palette.line);
      doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`Période A : ${periodLabel}`, 72, compareY + 12, { width: 450 });
      doc.fillColor(palette.muted).fontSize(8).text(`Période B : ${comparisonLabel}`, 72, compareY + 26, { width: 450 });
      doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(8).text(`${analysis.reviews.count} vs ${analysis.comparison.previousReviewCount} avis · ${analysis.trends.recentAverage}/5 vs ${analysis.comparison.previousAverageRating}/5 · ${analysis.scans.conversionRate}% vs ${analysis.comparison.previousConversionRate}% de conversion`, 72, compareY + 40, { width: 450 });
      doc.y = compareY + 66;
    }

    drawSectionTitle(doc, 'Verbatims marquants', 'Les avis les plus représentatifs de la période, à lire en premier.');
    drawVerbatims(doc, verbatims);

    drawSectionTitle(doc, 'Sujets récurrents', 'Détection automatique par mots-clés.');
    drawTopicRows(doc, analysis.topics, { emptyMessage: 'Aucun sujet récurrent détecté sur cette période.' });

    drawSectionTitle(doc, 'Recommandations', 'Générées par l’assistant IA depuis l’écran d’analyse.');
    if (recommendations && recommendations.length) {
      recommendations.slice(0, 4).forEach((item, index) => drawRecommendationCard(doc, index, item));
    } else {
      ensureSpace(doc, 30);
      doc.fillColor(palette.muted).fontSize(9).text('Aucune recommandation générée pour cette période. Utilisez le bouton « Obtenir des recommandations » avant l’export.', 62, doc.y, { width: 470 });
      doc.moveDown(0.8);
    }

    doc.fillColor(palette.muted).fontSize(8).text('Les avis archivés sont exclus de cette analyse.', 48, 782, { width: 499, align: 'center' });
    doc.end();
  });
}
