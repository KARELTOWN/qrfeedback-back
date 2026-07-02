import { body } from 'express-validator';

const strongPasswordMessage = 'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un symbole.';

export const signupValidator = [
  body('companyName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage("Le nom de l'entreprise doit contenir entre 2 et 120 caractères."),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Adresse email invalide.')
    .normalizeEmail(),
  body('password')
    .isStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1
    })
    .withMessage(strongPasswordMessage)
];

export const loginValidator = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Mot de passe requis.')
];

export const telegramAuthValidator = [
  body('initData')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Donnees d’authentification Telegram requises.'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Adresse email invalide.')
    .normalizeEmail(),
  body('companyName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage("Le nom de l'entreprise doit contenir entre 2 et 120 caracteres.")
];

export const changePasswordValidator = [
  body('currentPassword').isLength({ min: 8 }).withMessage('Mot de passe actuel requis.'),
  body('newPassword')
    .isStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1
    })
    .withMessage(strongPasswordMessage)
];

export const forgotPasswordValidator = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail()
];

export const resetPasswordValidator = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code OTP invalide.'),
  body('password')
    .isStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1
    })
    .withMessage(strongPasswordMessage)
];

export const verifyOtpValidator = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code OTP invalide.'),
  body('purpose').isIn(['signup', 'login', 'reset-password']).withMessage('Type de vérification invalide.')
];

export const resendOtpValidator = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
  body('purpose').isIn(['signup', 'login', 'reset-password']).withMessage('Type de vérification invalide.')
];
