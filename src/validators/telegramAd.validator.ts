import { body, param } from "express-validator";

const mediaValidator = [
  body("media").optional().isArray({ max: 10 }).withMessage("Maximum 10 medias."),
  body("media.*.type")
    .optional()
    .isIn(["image", "video", "audio"])
    .withMessage("Type de media invalide."),
  body("media.*.url")
    .optional()
    .isURL({ require_protocol: true, protocols: ["http", "https"] })
    .withMessage("URL de media invalide."),
  body("media.*.caption")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 180 })
    .withMessage("Legende trop longue."),
];

export const telegramAdIdValidator = [
  param("adId").isMongoId().withMessage("Publicite invalide."),
];

export const createTelegramAdValidator = [
  body("title")
    .isString()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage("Titre requis, 120 caracteres maximum."),
  body("contentHtml")
    .isString()
    .trim()
    .isLength({ min: 2, max: 12000 })
    .withMessage("Contenu requis, 12000 caracteres maximum."),
  body("isActive").optional().isBoolean().withMessage("Statut invalide."),
  body("startsAt").isISO8601().withMessage("Date de debut invalide."),
  body("endsAt").isISO8601().withMessage("Date de fin invalide."),
  ...mediaValidator,
];

export const updateTelegramAdValidator = [
  ...telegramAdIdValidator,
  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage("Titre invalide."),
  body("contentHtml")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 12000 })
    .withMessage("Contenu invalide."),
  body("isActive").optional().isBoolean().withMessage("Statut invalide."),
  body("startsAt").optional().isISO8601().withMessage("Date de debut invalide."),
  body("endsAt").optional().isISO8601().withMessage("Date de fin invalide."),
  ...mediaValidator,
];

export const setTelegramAdActiveValidator = [
  ...telegramAdIdValidator,
  body("isActive").isBoolean().withMessage("Statut invalide."),
];
