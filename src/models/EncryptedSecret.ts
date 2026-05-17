import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const secretNames = [
  'jwtSecret',
  'monerooApiKey',
  'monerooWebhookSecret',
  'twilioAccountSid',
  'twilioAuthToken',
  'paymentConfirmSecret'
] as const;

export type SecretName = typeof secretNames[number];

const encryptedSecretSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  name: { type: String, required: true, enum: secretNames, index: true },
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  tag: { type: String, required: true },
  keyVersion: { type: String, required: true },
  maskedValue: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

encryptedSecretSchema.index({ company: 1, name: 1 }, { unique: true });

export type IEncryptedSecret = InferSchemaType<typeof encryptedSecretSchema> & {
  _id: Types.ObjectId;
};

export const EncryptedSecret = mongoose.model<IEncryptedSecret>('EncryptedSecret', encryptedSecretSchema);
