import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const reviewSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  qrCode: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyQrCode', index: true },
  customerName: { type: String, trim: true },
  customerPhone: { type: String, trim: true },
  serviceFeedback: { type: String, trim: true },
  improvementSuggestion: { type: String, trim: true },
  badExperience: { type: String, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  notifiedAt: { type: Date },
  notificationStatus: {
    type: String,
    enum: ['pending', 'queued', 'sent', 'delivered', 'skipped', 'failed'],
    default: 'pending'
  },
  notificationError: { type: String },
  notificationWhatsappNumber: { type: String, trim: true },
  twilioMessageSid: { type: String, trim: true, index: true },
  notificationChargedAt: { type: Date }
}, { timestamps: true });

export type IReview = InferSchemaType<typeof reviewSchema> & {
  _id: Types.ObjectId;
};

export const Review = mongoose.model<IReview>('Review', reviewSchema);
