import PDFDocument from 'pdfkit';

type BuildQrPdfInput = {
  companyName: string;
  feedbackUrl: string;
  qrCodeDataUrl: string;
};

export function buildQrPdfBuffer({ companyName, feedbackUrl, qrCodeDataUrl }: BuildQrPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc
      .roundedRect(36, 36, 523, 770, 18)
      .fillAndStroke('#f8fafc', '#dbe3ee');

    doc
      .fillColor('#0f766e')
      .fontSize(12)
      .text('QR FEEDBACK', 70, 72, { align: 'center', width: 455 });

    doc
      .fillColor('#102a43')
      .fontSize(26)
      .text(companyName, 70, 104, { align: 'center', width: 455 });

    doc
      .fillColor('#52677a')
      .fontSize(13)
      .text('Scannez ce code pour laisser un avis client.', 92, 148, { align: 'center', width: 410 });

    doc
      .roundedRect(157, 198, 280, 280, 18)
      .fillAndStroke('#ffffff', '#cbd5e1');

    const base64 = qrCodeDataUrl.split(',')[1];
    const imageBuffer = Buffer.from(base64, 'base64');
    doc.image(imageBuffer, 177, 218, { width: 240, height: 240 });

    doc
      .fillColor('#102a43')
      .fontSize(15)
      .text('Votre lien direct', 70, 520, { align: 'center', width: 455 });

    doc
      .roundedRect(82, 552, 430, 62, 12)
      .fillAndStroke('#ffffff', '#dbe3ee');

    doc
      .fillColor('#0f766e')
      .fontSize(10)
      .text(feedbackUrl, 104, 575, { align: 'center', link: feedbackUrl, width: 386 });

    doc
      .fillColor('#52677a')
      .fontSize(11)
      .text('Imprimez ce document et placez-le à l’accueil, sur les tables ou près de la caisse.', 98, 660, { align: 'center', width: 400 });

    doc.end();
  });
}
