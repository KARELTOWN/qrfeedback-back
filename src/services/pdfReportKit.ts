import type { HydratedDocument } from 'mongoose';
import { type IReview } from '../models/Review.js';
import { inferSentiment } from './typesense.service.js';

export const palette = {
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

type TopicLike = { label: string; count: number; averageRating: number };

export function drawPageFrame(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, 595, 842).fillColor(palette.panel).fill();
  doc.roundedRect(34, 34, 527, 774, 18).fillAndStroke(palette.white, palette.line);
}

export function drawPill(doc: PDFKit.PDFDocument, text: string, x: number, y: number, color: string, bg: string) {
  doc.roundedRect(x, y, 118, 22, 11).fillColor(bg).fill();
  doc.fillColor(color).fontSize(8).font('Helvetica-Bold').text(text, x + 10, y + 7, { width: 98, align: 'center' });
}

export function drawBar(doc: PDFKit.PDFDocument, x: number, y: number, width: number, rate: number, color: string) {
  const safeRate = Math.max(0, Math.min(1, rate));
  doc.roundedRect(x, y, width, 8, 4).fillColor('#e2e8f0').fill();
  doc.roundedRect(x, y, width * safeRate, 8, 4).fillColor(color).fill();
}

export function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > 770) {
    doc.addPage();
    doc.y = 56;
  }
}

export function drawKpiCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, title: string, value: string, detail: string) {
  doc.roundedRect(x, y, width, 78, 10).fillAndStroke(palette.white, palette.line);
  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), x + 14, y + 14, { width: width - 28 });
  doc.fillColor(palette.ink).fontSize(22).text(value, x + 14, y + 31, { width: width - 28 });
  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(detail, x + 14, y + 58, { width: width - 28 });
}

export function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  ensureSpace(doc, subtitle ? 52 : 34);
  doc.fillColor(palette.primaryDark).font('Helvetica-Bold').fontSize(14).text(title, 48, doc.y);
  if (subtitle) {
    doc.moveDown(0.25);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(subtitle, 48, doc.y, { width: 499 });
  }
  doc.moveDown(0.5);
}

export function drawTopicRows(doc: PDFKit.PDFDocument, topics: TopicLike[], opts: { limit?: number; emptyMessage?: string } = {}) {
  const limit = opts.limit ?? 5;
  if (!topics.length) {
    doc.fillColor(palette.muted).fontSize(9).text(opts.emptyMessage || 'Aucun sujet récurrent détecté.', 62, doc.y, { width: 470 });
    doc.moveDown(0.8);
    return;
  }

  const shown = topics.slice(0, limit);
  for (const topic of shown) {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.roundedRect(56, y, 483, 30, 6).fillAndStroke(palette.white, palette.line);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(9).text(topic.label, 70, y + 9, { width: 245 });
    doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`${topic.count} avis`, 320, y + 10, { width: 70 });
    drawBar(doc, 388, y + 12, 82, topic.averageRating / 5, topic.averageRating >= 4 ? palette.primary : palette.warning);
    doc.fillColor(palette.muted).fontSize(8).text(`${topic.averageRating}/5`, 478, y + 10, { width: 45, align: 'right' });
    doc.y = y + 38;
  }

  const remaining = topics.length - shown.length;
  if (remaining > 0) {
    ensureSpace(doc, 18);
    doc.fillColor(palette.muted).font('Helvetica-Oblique').fontSize(8).text(`+ ${remaining} autre(s) sujet(s) non affiché(s) ici.`, 62, doc.y, { width: 470 });
    doc.moveDown(0.6);
  }
}

export function truncateQuote(text: string, maxLength = 160) {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trim()}…` : trimmed;
}

function reviewText(review: HydratedDocument<IReview>) {
  return (review.serviceFeedback || '').trim();
}

export function pickVerbatim(reviews: HydratedDocument<IReview>[], sentimentType: 'positive' | 'neutral' | 'negative') {
  const matching = reviews.filter((review) => inferSentiment(review).sentiment === sentimentType && reviewText(review).length > 0);
  if (!matching.length) return null;
  const representative = matching.filter((review) => reviewText(review).length >= 15);
  const pool = representative.length ? representative : matching;
  return pool.reduce((best, current) => (reviewText(current).length > reviewText(best).length ? current : best));
}

export function buildVerbatims(reviews: HydratedDocument<IReview>[]) {
  return {
    positive: pickVerbatim(reviews, 'positive'),
    negative: pickVerbatim(reviews, 'negative'),
    neutral: pickVerbatim(reviews, 'neutral'),
  };
}

export function drawVerbatimCard(doc: PDFKit.PDFDocument, label: string, accent: string, accentSoft: string, review: HydratedDocument<IReview> | null, emptyMessage: string) {
  ensureSpace(doc, 84);
  const y = doc.y;
  if (!review) {
    doc.roundedRect(56, y, 483, 30, 6).fillAndStroke(palette.panel, palette.line);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`${label} : ${emptyMessage}`, 72, y + 11, { width: 450 });
    doc.y = y + 38;
    return;
  }

  const qrLabel = (review.qrCode as unknown as { label?: string; slug?: string } | undefined)?.label;
  doc.roundedRect(56, y, 483, 76, 8).fillAndStroke(palette.white, palette.line);
  doc.roundedRect(56, y, 5, 76, 3).fillColor(accent).fill();
  drawPill(doc, label, 72, y + 10, accent, accentSoft);
  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`${review.rating}/5${qrLabel ? ` · ${qrLabel}` : ''}`, 200, y + 15, { width: 270, align: 'right' });
  doc.fillColor(palette.ink).font('Helvetica-Oblique').fontSize(9).text(`“${truncateQuote(review.serviceFeedback || '')}”`, 72, y + 40, { width: 450 });
  doc.y = y + 86;
}

export function drawVerbatims(doc: PDFKit.PDFDocument, verbatims: ReturnType<typeof buildVerbatims>, emptyMessage = 'aucun commentaire correspondant sur cette période.') {
  drawVerbatimCard(doc, 'Avis positif', palette.primaryDark, palette.primarySoft, verbatims.positive, emptyMessage);
  drawVerbatimCard(doc, 'Avis négatif', palette.danger, palette.dangerSoft, verbatims.negative, emptyMessage);
  drawVerbatimCard(doc, 'Avis neutre', palette.warning, palette.warningSoft, verbatims.neutral, emptyMessage);
}
