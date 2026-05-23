import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const contactSources = [
  'manual',
  'import',
  'qr_feedback',
  'automation',
  'api'
] as const;

export type ContactSource = typeof contactSources[number];

const contactSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true },
  emailNormalized: { type: String, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  phoneNormalized: { type: String, trim: true },
  whatsapp: { type: String, trim: true },
  whatsappNormalized: { type: String, trim: true },
  rating: { type: Number, min: 1, max: 5 },
  tags: [{ type: String, trim: true, index: true }],
  customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  source: { type: String, enum: contactSources, default: 'manual', index: true },
  lastActivityAt: { type: Date, index: true },
  lastFeedbackAt: { type: Date, index: true },
  archivedAt: { type: Date, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

contactSchema.index(
  { company: 1, whatsappNormalized: 1 },
  { unique: true, partialFilterExpression: { whatsappNormalized: { $type: 'string' } } }
);
contactSchema.index(
  { company: 1, phoneNormalized: 1 },
  { unique: true, partialFilterExpression: { phoneNormalized: { $type: 'string' } } }
);
contactSchema.index(
  { company: 1, emailNormalized: 1 },
  { unique: true, partialFilterExpression: { emailNormalized: { $type: 'string' } } }
);
contactSchema.index({ company: 1, tags: 1 });
contactSchema.index({ company: 1, lastActivityAt: -1 });
contactSchema.index({ company: 1, createdAt: -1 });
contactSchema.index({ company: 1, archivedAt: 1 });

export type IContact = InferSchemaType<typeof contactSchema> & {
  _id: Types.ObjectId;
};

export const Contact = mongoose.model<IContact>('Contact', contactSchema);
