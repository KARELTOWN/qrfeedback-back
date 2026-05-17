import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const paymentSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  planCode: { type: String, required: true },
  messages: { type: Number, required: true },
  amountFcfa: { type: Number, required: true },
  moneroWalletAddress: { type: String, required: true },
  provider: { type: String, enum: ['moneroo', 'manual_monero'], default: 'moneroo' },
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
