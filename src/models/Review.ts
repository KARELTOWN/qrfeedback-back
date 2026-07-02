import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const reviewSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyQrCode', index: true },
  serviceFeedback: { type: String, trim: true },
  customAnswers: [{
    questionId: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ['text', 'textarea', 'rating', 'select', 'email', 'phone', 'fullName'], required: true },
    value: { type: mongoose.Schema.Types.Mixed }
  }],
  rating: { type: Number, required: true, min: 1, max: 5 },
  notifiedAt: { type: Date },
  notificationStatus: {
    type: String,
    enum: ['pending', 'queued', 'sent', 'delivered', 'skipped', 'failed'],
    default: 'pending'
  },
  notificationError: { type: String },
  notificationChargedAt: { type: Date },
  emailNotificationStatus: {
    type: String,
    enum: ['pending', 'sent', 'skipped', 'failed'],
    default: 'pending'
  },
  emailNotificationError: { type: String },
  notificationEmail: { type: String, trim: true },
  emailNotificationChargedAt: { type: Date },
  moderationStatus: {
    type: String,
    enum: ['published', 'archived'],
    default: 'published',
    index: true
  },
  tags: [{ type: String, trim: true }],
  internalNote: { type: String, trim: true },
  responseText: { type: String, trim: true },
  respondedAt: { type: Date },
  clientEmail: { type: String, trim: true, lowercase: true },
  clientPhone: { type: String, trim: true },
  clientEmailStatus: {
    type: String,
    enum: ['pending', 'sent', 'skipped', 'failed'],
    default: 'skipped'
  },
  clientEmailError: { type: String },
  clientSmsStatus: {
    type: String,
    enum: ['pending', 'sent', 'skipped', 'failed'],
    default: 'skipped'
  },
  clientSmsError: { type: String },
  managerSmsStatus: {
    type: String,
    enum: ['pending', 'sent', 'skipped', 'failed'],
    default: 'skipped'
  },
  managerSmsError: { type: String }
}, { timestamps: true });

export type IReview = InferSchemaType<typeof reviewSchema> & {
  _id: Types.ObjectId;
};

export const Review = mongoose.model<IReview>('Review', reviewSchema);
