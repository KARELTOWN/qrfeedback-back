import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outputPath = resolve('output/pdf/bilan-hebdomadaire-pro-qr-feedback.pdf');
mkdirSync(dirname(outputPath), { recursive: true });

const palette = {
  primary: '#0f766e',
  primaryDark: '#115e59',
  primarySoft: '#ccfbf1',
  ink: '#102a43',
  muted: '#64748b',
  line: '#dbe3ee',
  panel: '#f8fafc',
  danger: '#dc2626',
  warning: '#d97706',
  white: '#ffffff',
};

function drawPill(doc: PDFKit.PDFDocument, text: string, x: number, y: number, color: string, bg: string) {
  doc.roundedRect(x, y, 118, 22, 11).fillColor(bg).fill();
  doc.fillColor(color).fontSize(8).font('Helvetica-Bold').text(text, x + 10, y + 7, { width: 98, align: 'center' });
}

function drawBar(doc: PDFKit.PDFDocument, x: number, y: number, width: number, rate: number, color: string) {
  doc.roundedRect(x, y, width, 8, 4).fillColor('#e2e8f0').fill();
  doc.roundedRect(x, y, width * Math.max(0, Math.min(1, rate)), 8, 4).fillColor(color).fill();
}

function drawKpiCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, title: string, value: string, detail: string) {
  doc.roundedRect(x, y, width, 78, 10).fillAndStroke(palette.white, palette.line);
  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), x + 14, y + 14, { width: width - 28 });
  doc.fillColor(palette.ink).fontSize(22).text(value, x + 14, y + 31, { width: width - 28 });
  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(detail, x + 14, y + 58, { width: width - 28 });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.fillColor(palette.primaryDark).font('Helvetica-Bold').fontSize(14).text(title, 48, doc.y);
  if (subtitle) {
    doc.moveDown(0.25);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(subtitle, 48, doc.y, { width: 499 });
  }
  doc.moveDown(0.5);
}

function topicRow(doc: PDFKit.PDFDocument, label: string, count: number, rating: number) {
  const y = doc.y;
  doc.roundedRect(56, y, 483, 30, 6).fillAndStroke(palette.white, palette.line);
  doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(9).text(label, 70, y + 9, { width: 245 });
  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(`${count} avis`, 320, y + 10, { width: 70 });
  drawBar(doc, 388, y + 12, 82, rating / 5, rating >= 4 ? palette.primary : palette.warning);
  doc.fillColor(palette.muted).fontSize(8).text(`${rating}/5`, 478, y + 10, { width: 45, align: 'right' });
  doc.y = y + 38;
}

function recommendation(doc: PDFKit.PDFDocument, text: string) {
  const y = doc.y;
  doc.roundedRect(56, y, 483, 34, 8).fillAndStroke(palette.primarySoft, '#99f6e4');
  doc.fillColor(palette.primaryDark).font('Helvetica-Bold').fontSize(8).text('ACTION', 72, y + 11, { width: 50 });
  doc.fillColor(palette.ink).font('Helvetica').fontSize(9).text(text, 126, y + 9, { width: 390 });
  doc.y = y + 44;
}

function qrCard(doc: PDFKit.PDFDocument, label: string, reviews: number, rating: number, positive: number, negative: number, topic: string) {
  const y = doc.y;
  doc.roundedRect(56, y, 483, 86, 8).fillAndStroke(palette.white, palette.line);
  doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(11).text(label, 72, y + 13, { width: 250 });
  drawPill(doc, `${reviews} avis`, 395, y + 10, palette.primaryDark, palette.primarySoft);
  doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(`Note moyenne : ${rating}/5`, 72, y + 34, { width: 160 });
  doc.text(`Positif : ${positive}%`, 226, y + 34, { width: 100 });
  doc.text(`Négatif : ${negative}%`, 328, y + 34, { width: 100 });
  doc.fillColor(palette.ink).fontSize(8).text(`À surveiller : ${topic}`, 72, y + 58, { width: 420 });
  doc.y = y + 96;
}

const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Bilan hebdomadaire Opinbase - aperçu' } });
doc.pipe(createWriteStream(outputPath));

doc.rect(0, 0, 595, 842).fillColor(palette.panel).fill();
doc.roundedRect(34, 34, 527, 774, 18).fillAndStroke(palette.white, palette.line);
doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
doc.fillColor(palette.ink).fontSize(24).text('Bilan hebdomadaire', 48, 84, { width: 340 });
doc.fillColor(palette.muted).font('Helvetica').fontSize(10).text('Restaurant Demo - 8 juin 2026 au 14 juin 2026', 48, 116, { width: 420 });
drawPill(doc, 'Rapport automatique', 416, 64, palette.primaryDark, palette.primarySoft);

drawKpiCard(doc, 48, 154, 154, 'Avis collectés', '184', '+32 vs semaine préc.');
drawKpiCard(doc, 220, 154, 154, 'Note moyenne', '4.2/5', '+0.3 pt');
drawKpiCard(doc, 392, 154, 154, 'Avis positifs', '71%', '12% négatifs');

doc.y = 260;
sectionTitle(doc, 'Lecture rapide', 'Les signaux importants à regarder avant de passer aux détails.');
const sentimentY = doc.y;
doc.roundedRect(56, sentimentY, 483, 76, 8).fillAndStroke(palette.panel, palette.line);
doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(10).text('Répartition des sentiments', 72, sentimentY + 14);
doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text('Positif 71%', 72, sentimentY + 38);
drawBar(doc, 160, sentimentY + 41, 95, 0.71, palette.primary);
doc.text('Neutre 17%', 270, sentimentY + 38);
drawBar(doc, 344, sentimentY + 41, 65, 0.17, palette.warning);
doc.text('Négatif 12%', 424, sentimentY + 38);
drawBar(doc, 490, sentimentY + 41, 35, 0.12, palette.danger);
doc.y = sentimentY + 96;

sectionTitle(doc, 'Priorités détectées par l’analyse IA');
topicRow(doc, "Temps d'attente", 28, 3.1);
topicRow(doc, 'Accueil et service', 19, 3.8);
topicRow(doc, 'Qualité produit/service', 14, 4.1);
topicRow(doc, 'Paiement', 7, 3.6);

sectionTitle(doc, 'Recommandations de la semaine');
recommendation(doc, "Réduire l'attente aux heures de pointe : le sujet revient dans 28 avis.");
recommendation(doc, 'Former l’équipe accueil sur les réponses rapides aux clients mécontents.');
recommendation(doc, 'Tester un rappel QR en fin de service pour augmenter le volume d’avis utiles.');

doc.addPage();
doc.rect(0, 0, 595, 842).fillColor(palette.panel).fill();
doc.roundedRect(34, 34, 527, 774, 18).fillAndStroke(palette.white, palette.line);
doc.fillColor(palette.primary).font('Helvetica-Bold').fontSize(10).text('QR FEEDBACK', 48, 62);
doc.fillColor(palette.ink).fontSize(20).text('Performance par QR code', 48, 86, { width: 400 });
doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text('Classement des points de collecte les plus actifs et leurs sujets récurrents.', 48, 116, { width: 460 });
doc.y = 154;
qrCard(doc, 'TABLE 1', 62, 4.6, 84, 5, 'Aucun irritant récurrent');
qrCard(doc, 'COMPTOIR', 48, 3.9, 65, 18, "Temps d'attente (15), Paiement (5)");
qrCard(doc, 'TERRASSE', 39, 4.1, 70, 13, 'Accueil et service (8)');
qrCard(doc, 'LIVRAISON', 35, 3.6, 55, 24, 'Disponibilité (9), Qualité produit/service (7)');
doc.fillColor(palette.muted).fontSize(8).text('Les avis archivés sont exclus du bilan. Les tendances sont calculées sur la semaine précédente.', 48, 782, { width: 499, align: 'center' });

doc.end();
doc.on('end', () => {
  console.log(outputPath);
});
