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
  notificationWhatsappNumber: { type: String, trim: true },
  whatsappMessageId: { type: String, trim: true, index: true },
  notificationChargedAt: { type: Date },
  emailNotificationStatus: {
    type: String,
    enum: ['pending', 'sent', 'skipped', 'failed'],
    default: 'pending'
  },
  emailNotificationError: { type: String },
  notificationEmail: { type: String, trim: true },
  emailNotificationChargedAt: { type: Date }
}, { timestamps: true });

export type IReview = InferSchemaType<typeof reviewSchema> & {
  _id: Types.ObjectId;
};

export const Review = mongoose.model<IReview>('Review', reviewSchema);
