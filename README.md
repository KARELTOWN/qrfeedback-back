# QR Feedback Backend

API Node.js/Express en TypeScript pour une plateforme de collecte d'avis clients par QR Code.

Elle permet de :

- inscrire une entreprise sans compte et générer un lien/QR Code public ;
- collecter des avis clients ;
- notifier l'entreprise sur WhatsApp via Twilio ;
- gérer des crédits de notifications ;
- créer des comptes entreprise ;
- gérer l'authentification et le mot de passe oublié ;
- vendre des forfaits via Moneroo ;
- exporter les avis en CSV ;
- stocker certaines clés sensibles dans un coffre local chiffré.

## Stack

- Node.js + Express
- TypeScript
- MongoDB + Mongoose
- Twilio WhatsApp
- Moneroo Payments
- QR Code via `qrcode`
- PDF via `pdfkit`
- Validation backend via `express-validator`

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

Vérification TypeScript :

```bash
npm run type-check
```

## Architecture

La logique est séparée par responsabilité :

```text
src/routes        Déclare les endpoints et branche les middlewares
src/validators    Valide les entrées avec express-validator
src/controllers   Reçoit la requête et appelle le service adapté
src/services      Contient la logique métier et les intégrations externes
src/models        Modèles Mongoose
src/middleware    Middlewares Express
src/utils         Helpers techniques
src/jobs          Tâches planifiées
```

Les routes ne doivent pas contenir de logique métier.  
Les controllers ne doivent pas faire d'opérations métier lourdes.  
Les services portent la logique réelle.

## Variables d'environnement

Copier `.env.example` vers `.env`, puis renseigner les valeurs nécessaires.

Variables importantes :

```env
PORT=4000
BACKEND_URL=http://localhost:4000
MONGO_URI=mongodb://mongo:27017/qr_feedback
FRONTEND_URL=http://localhost:5173
JWT_SECRET=
ENCRYPTION_MASTER_KEY=

TWILIO_WHATSAPP_FROM=whatsapp:+2290199997478
TWILIO_STATUS_CALLBACK_URL=

MONEROO_API_URL=https://api.moneroo.io
MONEROO_CURRENCY=XOF
```

`JWT_SECRET` peut rester dans `.env`, mais il peut aussi être stocké dans le coffre chiffré local.

## Secrets chiffrés

Les secrets plateforme suivants peuvent être stockés localement sous forme chiffrée :

```text
jwtSecret
monerooApiKey
monerooWebhookSecret
twilioAccountSid
twilioAuthToken
paymentConfirmSecret
```

Ils sont écrits dans :

```text
storage/secrets
```

Ce dossier doit rester privé et ne doit pas être versionné.

### Générer la clé maître

```bash
npm run generate:encryption-key
```

Mettre la valeur générée dans `.env` :

```env
ENCRYPTION_MASTER_KEY=...
```

Important : `ENCRYPTION_MASTER_KEY` ne doit pas être stockée dans le coffre, car c'est la clé qui permet de l'ouvrir. Elle doit être fournie par l'environnement serveur, Docker Secret, CI/CD secret, ou autre mécanisme d'infrastructure.

### Chiffrer un secret

```bash
npm run secret:set
```

Exemple :

```text
Nom du secret à chiffrer: monerooApiKey
Valeur à chiffrer: test_xxxxx
```

### Lister les secrets masqués

```bash
npm run secret:list
```

L'application lit d'abord `storage/secrets`, puis retombe sur `.env` si nécessaire.

## Moneroo

L'intégration suit la documentation Moneroo :

- authentification avec `Authorization: Bearer SECRET_KEY` ;
- initialisation via `POST /v1/payments/initialize` ;
- redirection vers `checkout_url` ;
- vérification serveur via `GET /v1/payments/{paymentId}/verify` ;
- webhook signé avec `X-Moneroo-Signature`.

Secrets à configurer :

```bash
npm run secret:set
```

Puis saisir :

```text
monerooApiKey
monerooWebhookSecret
```

Webhook à configurer dans Moneroo :

```text
https://votre-domaine.com/api/payments/moneroo/webhook
```

## Twilio WhatsApp

Le numéro expéditeur reste en `.env` :

```env
TWILIO_WHATSAPP_FROM=whatsapp:+2290199997478
```

Les clés sensibles peuvent être chiffrées :

```text
twilioAccountSid
twilioAuthToken
```

Si Twilio n'est pas configuré, l'application passe en mode log/mock.

Pour savoir si un message WhatsApp est reellement envoye, Twilio renvoie des statuts (`queued`,
`sent`, `delivered`, `failed`, `undelivered`) sur le webhook suivant :

```text
POST /api/webhooks/twilio/status
```

Configurez une URL publique accessible par Twilio :

```env
BACKEND_URL=https://votre-domaine.com
```

ou directement :

```env
TWILIO_STATUS_CALLBACK_URL=https://votre-domaine.com/api/webhooks/twilio/status
```

En local, utilisez une URL publique de tunnel, par exemple ngrok. Le credit WhatsApp est decompte
une seule fois lorsque Twilio confirme `sent` ou `delivered`. Les statuts `failed` et `undelivered`
ne consomment pas de credit.

## Routes principales

### Auth

- `POST /api/auth/signup` : création de compte entreprise
- `POST /api/auth/login` : connexion
- `POST /api/auth/change-password` : changement de mot de passe
- `POST /api/auth/forgot-password` : demande de réinitialisation
- `POST /api/auth/reset-password` : réinitialisation

### Entreprises et avis

- `POST /api/companies/register` : inscription sans compte, lien et QR Code
- `GET /api/companies/:slug` : entreprise publique
- `POST /api/reviews/:slug` : dépôt d'un avis

### Dashboard

Routes protégées par JWT :

- `GET /api/dashboard/reviews`
- `GET /api/dashboard/stats`
- `GET /api/dashboard/export.csv`

### Paiements

- `GET /api/plans` : forfaits disponibles
- `POST /api/payments` : paiement public lié à une entreprise
- `POST /api/payments/authenticated` : paiement depuis un compte connecté
- `POST /api/payments/:id/verify` : vérification serveur après retour Moneroo
- `POST /api/payments/moneroo/webhook` : webhook Moneroo
- `POST /api/payments/:id/confirm` : confirmation manuelle/admin avec `x-payment-secret`
- `POST /api/webhooks/twilio/status` : callback de statut Twilio WhatsApp

## Docker

L'image backend compile TypeScript puis lance :

```bash
node dist/server.js
```

Le dossier `storage/secrets` est exclu du build Docker par `.dockerignore`. En production, monter ce dossier ou injecter les secrets selon votre stratégie d'infrastructure.

## Notes de sécurité

- Ne versionnez jamais `.env`.
- Ne versionnez jamais `storage/secrets`.
- Ne perdez pas `ENCRYPTION_MASTER_KEY`.
- Préférez les webhooks Moneroo signés à la confirmation manuelle.
- Gardez `paymentConfirmSecret` uniquement comme mécanisme admin/fallback.
