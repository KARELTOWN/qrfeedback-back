import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const qrFormFieldMappingSchema = new mongoose.Schema({
  formFieldKey: { type: String, required: true, trim: true },
  formFieldLabel: { type: String, trim: true },
  listAttributeKey: { type: String, required: true, trim: true, lowercase: true },
  createIfMissing: { type: Boolean, default: false }
}, { _id: false });

const qrFormListMappingSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyQrCode', required: true, index: true },
  list: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactList', required: true, index: true },
  fieldMappings: [qrFormFieldMappingSchema],
  autoCreateContact: { type: Boolean, default: true },
  autoAddToList: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

qrFormListMappingSchema.index({ company: 1, qrCode: 1 }, { unique: true });

export type IQrFormListMapping = InferSchemaType<typeof qrFormListMappingSchema> & {
  _id: Types.ObjectId;
};

export const QrFormListMapping = mongoose.model<IQrFormListMapping>(
  'QrFormListMapping',
  qrFormListMappingSchema
);
