import { body } from "express-validator";

export const twilioStatusValidator = [
  body("MessageSid").isString().notEmpty(),
  body("MessageStatus").optional().isString(),
  body("SmsStatus").optional().isString(),
  body("ErrorCode").optional().isString(),
  body("ErrorMessage").optional().isString(),
];
