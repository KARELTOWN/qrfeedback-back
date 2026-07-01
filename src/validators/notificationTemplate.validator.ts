import { body, param } from "express-validator";

const variableValidator = (field: "emailVariables" | "smsVariables") =>
  body(field).optional().isArray().withMessage(`${field} doit être une liste.`)
    .bail().custom((items: unknown[]) => items.every((item) => item && typeof item === "object" && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(String((item as { key?: unknown }).key || "")) && String((item as { label?: unknown }).label || "").trim().length > 0)).withMessage(`${field} contient une variable invalide.`);

export const notificationTemplateNameValidator = [param("name").matches(/^[a-z0-9][a-z0-9-]*$/).withMessage("Nom de modèle invalide.")];
export const createNotificationTemplateValidator = [
  body("name").matches(/^[a-z0-9][a-z0-9-]*$/).withMessage("Nom de modèle invalide."),
  body("label").trim().isLength({ min: 2, max: 120 }).withMessage("Libellé invalide."),
  body("emailTemplate").optional().isString().isLength({ max: 100_000 }),
  body("smsTemplate").optional().isString().isLength({ max: 2_000 }),
  body("emailTitle").optional().isString().isLength({ max: 250 }),
  body("smsTitle").optional().isString().isLength({ max: 160 }),
  body("isActive").optional().isBoolean(),
  variableValidator("emailVariables"), variableValidator("smsVariables"),
];
export const updateNotificationTemplateValidator = [
  ...notificationTemplateNameValidator,
  body("name").not().exists().withMessage("Le nom d’un modèle ne peut pas être modifié."),
  body("label").optional().trim().isLength({ min: 2, max: 120 }),
  body("emailTemplate").optional().isString().isLength({ max: 100_000 }),
  body("smsTemplate").optional().isString().isLength({ max: 2_000 }),
  body("emailTitle").optional().isString().isLength({ max: 250 }),
  body("smsTitle").optional().isString().isLength({ max: 160 }),
  body("isActive").optional().isBoolean(),
  variableValidator("emailVariables"), variableValidator("smsVariables"),
];
export const previewNotificationTemplateValidator = [...notificationTemplateNameValidator, body("variables").optional().isObject().withMessage("Variables invalides.")];
