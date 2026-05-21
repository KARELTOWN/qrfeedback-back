import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const reminderSchema = new mongoose.Schema({
  dueAt: { type: Date, required: true },
  sentAt: { type: Date },
  kind: { type: String, required: true }
}, { _id: false });

const feedbackFieldSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true, trim: true },
  placeholder: { type: String, trim: true },
  enabled: { type: Boolean, default: true },
  required: { type: Boolean, default: false }
}, { _id: false });

const customQuestionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, enum: ['text', 'textarea', 'rating', 'select', 'email', 'phone'], required: true },
  label: { type: String, required: true, trim: true },
  placeholder: { type: String, trim: true },
  required: { type: Boolean, default: false },
  options: [{ type: String, trim: true }]
}, { _id: false });

const feedbackFormConfigSchema = new mongoose.Schema({
  title: { type: String, trim: true },
  fields: [feedbackFieldSchema],
  customQuestions: [customQuestionSchema]
}, { _id: false });

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  whatsappNumber: { type: String, trim: true, index: true },
  qrCodeDataUrl: { type: String },
  feedbackUrl: { type: String, required: true },
  freeMessagesLimit: { type: Number, default: 20 },
  freeMessagesUsed: { type: Number, default: 0 },
  paidMessagesBalance: { type: Number, default: 0 },
  limitReachedAt: { type: Date },
  reminderSchedule: [reminderSchema],
  feedbackFormConfig: feedbackFormConfigSchema,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export type IReminder = InferSchemaType<typeof reminderSchema>;
export type ICompany = InferSchemaType<typeof companySchema> & {
  _id: Types.ObjectId;
};

export const Company = mongoose.model<ICompany>('Company', companySchema);
