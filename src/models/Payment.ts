import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const paymentSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  planCode: { type: String, required: true },
  messages: { type: Number, required: true },
  emailNotifications: { type: Number, default: 0 },
  amountFcfa: { type: Number, required: true },
  provider: { type: String, enum: ['disabled'], default: 'disabled' },
  providerPaymentId: { type: String, index: true },
  checkoutUrl: { type: String },
  currency: { type: String, default: 'XOF' },
  status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
  paidAt: { type: Date },
  invoiceNumber: { type: String }
}, { timestamps: true });

export type IPayment = InferSchemaType<typeof paymentSchema> & {
  _id: Types.ObjectId;
};

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
