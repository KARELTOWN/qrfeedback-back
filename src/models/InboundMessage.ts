import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const inboundMessageSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  whatsappConfig: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyWhatsappConfig', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  contactMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactMessage', index: true },
  providerMessageId: { type: String, required: true, trim: true, unique: true, index: true },
  from: { type: String, required: true, trim: true },
  toPhoneNumberId: { type: String, required: true, trim: true, index: true },
  profileName: { type: String, trim: true },
  messageType: { type: String, trim: true },
  text: { type: String },
  payload: { type: mongoose.Schema.Types.Mixed },
  receivedAt: { type: Date, default: Date.now, index: true },
  processedAt: { type: Date }
}, { timestamps: true });

inboundMessageSchema.index({ company: 1, receivedAt: -1 });
inboundMessageSchema.index({ company: 1, contact: 1, receivedAt: -1 });

export type IInboundMessage = InferSchemaType<typeof inboundMessageSchema> & {
  _id: Types.ObjectId;
};

export const InboundMessage = mongoose.model<IInboundMessage>('InboundMessage', inboundMessageSchema);
