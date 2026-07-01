import mongoose, { type InferSchemaType, type Types } from "mongoose";

const variableSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
  },
  { _id: false },
);

const notificationTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    emailTemplate: { type: String, default: "" },
    smsTemplate: { type: String, default: "" },
    emailTitle: { type: String, default: "" },
    smsTitle: { type: String, default: "" },
    emailVariables: { type: [variableSchema], default: [] },
    smsVariables: { type: [variableSchema], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export type INotificationTemplate = InferSchemaType<typeof notificationTemplateSchema> & { _id: Types.ObjectId };
export const NotificationTemplate = mongoose.model<INotificationTemplate>("NotificationTemplate", notificationTemplateSchema);
