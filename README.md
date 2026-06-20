# QR Feedback Backend

API Node.js/Express en TypeScript pour une plateforme gratuite de collecte d'avis clients par QR code.

Elle permet de :

- inscrire une entreprise et generer un lien/QR code public ;
- collecter des avis clients depuis une URL publique ;
- notifier l'entreprise par email et via Telegram ;
- creer et connecter des comptes entreprise ;
- gerer plusieurs QR codes par entreprise ;
- consulter un dashboard d'avis, statistiques, exports Excel et analyse ;
- stocker certains secrets dans un coffre local chiffre.

## Stack

- Node.js + Express
- TypeScript
- MongoDB + Mongoose
- Telegram Bot API
- QR Code via `qrcode`
- PDF via `pdfkit`
- Validation backend via `express-validator`
- Recherche/analyse via Typesense

## Installation

```bash
cp .env.example .env
npm install
npm run dev
```

Build production :

```bash
npm run build
npm start
```

Verification :

```bash
npm run type-check
npm test
```

Documentation API :

```text
docs/openapi.yaml
```

## Variables importantes

```env
PORT=4000
BACKEND_URL=http://localhost:4000
MONGO_URI=mongodb://mongo:27017/qr_feedback
FRONTEND_URL=http://localhost:5173
JWT_SECRET=
ENCRYPTION_MASTER_KEY=

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=admin
SMTP_PASS=pass

TURNSTILE_SECRET_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=QrFeedback_Bot
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBAPP_URL=
TELEGRAM_AUTH_MAX_AGE_SECONDS=3600
```

## Modele produit

QrFeedback est gratuit et illimite. Les routes de paiement existent uniquement pour compatibilite avec d'anciens clients API et repondent `410 Gone`.

Les notifications temps reel sont concentrees sur Telegram. L'email reste le canal par defaut.

## Routes principales

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/telegram` — connexion ou inscription depuis une Telegram Web App
- `POST /api/auth/verify-otp`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### Entreprises et avis

- `POST /api/companies/register`
- `GET /api/companies/:slug`
- `POST /api/reviews/:slug`

Les routes publiques d'inscription et d'avis verifient Turnstile quand `TURNSTILE_SECRET_KEY` est configure.

### Dashboard

Routes protegees par JWT :

- `GET /api/dashboard/reviews`
- `GET /api/dashboard/stats`
- `GET /api/dashboard/monthly-evolution`
- `GET /api/dashboard/rating-distribution`
- `GET /api/dashboard/export.xlsx`
- `GET /api/dashboard/ai/overview`
- `GET /api/dashboard/ai/search`
- `GET /api/dashboard/qr-trends?weeks=4|6|8` — une serie sparkline par QR, avec min/max/moyenne/scans et tendance calculee par demi-periode

### Analyse et recommandations

- `POST /api/analyse` : analyse sans quota. Le body accepte `startDate` + `endDate` (ou `weeks: 4|6|8`, 4 par défaut) et `qrCodeId` optionnels. La reponse contient les avis de la periode, la comparaison avec la periode precedente, les commentaires urgents, les sujets recurrents et le taux scan → avis.
- `POST /api/recommandations` : recommandations priorisees a partir du payload d’analyse. Limite a 7 appels par semaine ISO et par utilisateur via Redis. Les headers `X-RateLimit-Remaining` et `X-Reset-At` indiquent le quota restant et sa date de reinitialisation.

### QR codes

- `GET /api/qrcodes`
- `POST /api/qrcodes`
- `PATCH /api/qrcodes/:qrCodeId/notifications`

### Telegram

#### Authentification Web App

Depuis l'application ouverte dans Telegram, envoyer `Telegram.WebApp.initData` au backend :

```json
POST /api/auth/telegram
{
  "initData": "Telegram.WebApp.initData",
  "email": "contact@entreprise.com",
  "companyName": "Mon entreprise"
}
```

`email` et `companyName` sont necessaires uniquement lors de la premiere inscription. Les appels suivants avec le meme compte Telegram renvoient directement le JWT habituel. Le backend valide la signature Telegram et la fraicheur de la session ; ne jamais faire confiance au profil lu directement dans le navigateur.

- `GET /api/notifications/telegram-link`
- `GET /api/notifications/telegram-profile`
- `POST /api/notifications/telegram-disconnect`
- `POST /api/webhooks/telegram`

## Secrets chiffres

Secrets supportes :

```text
jwtSecret
telegramBotToken
```

Generer une cle maitre :

```bash
npm run generate:encryption-key
```

Lister ou definir un secret :

```bash
npm run secret:list
npm run secret:set
```
