import QRCode from 'qrcode';

export function generateQrDataUrl(text: string) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    margin: 3,
    width: 1024,
    color: {
      dark: '#0f766e',
      light: '#ffffff'
    },
    rendererOpts: {
      quality: 1
    }
  });
}
