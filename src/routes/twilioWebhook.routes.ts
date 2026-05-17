import { Router } from "express";
import * as twilioWebhookController from "../controllers/twilioWebhook.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { twilioStatusValidator } from "../validators/twilioWebhook.validator.js";
import { handleValidation } from "../validators/validation.middleware.js";

const router = Router();

router.post(
  "/status",
  twilioStatusValidator,
  handleValidation,
  asyncHandler(twilioWebhookController.handleStatus),
);

export default router;
