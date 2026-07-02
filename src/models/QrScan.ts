import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const qrScanSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyQrCode', index: true },
  slug: { type: String, required: true, index: true },
  idempotencyKey: { type: String, trim: true, index: true },
  userAgent: { type: String, trim: true },
  source: { type: String, trim: true },
  scannedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

qrScanSchema.index({ company: 1, scannedAt: -1 });
qrScanSchema.index({ qrCode: 1, scannedAt: -1 });
qrScanSchema.index(
  { slug: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $type: 'string' } } }
);

export type IQrScan = InferSchemaType<typeof qrScanSchema> & {
  _id: Types.ObjectId;
};

export const QrScan = mongoose.model<IQrScan>('QrScan', qrScanSchema);
