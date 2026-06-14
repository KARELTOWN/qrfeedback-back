# QR Feedback Backend

API Node.js/Express en TypeScript pour une plateforme de collecte d'avis clients par QR Code.

Elle permet de :

- inscrire une entreprise sans compte et générer un lien/QR Code public ;
- collecter des avis clients ;
- notifier l'entreprise sur WhatsApp via WhatsApp Cloud API ;
- gérer des crédits de notifications ;
- créer des comptes entreprise ;
- gérer l'authentification et le mot de passe oublié ;
- conserver une gestion de forfaits/paiements generique ;
- exporter les avis en CSV ;
- stocker certaines clés sensibles dans un coffre local chiffré.

## Stack

- Node.js + Express
- TypeScript
- MongoDB + Mongoose
- WhatsApp Cloud API
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

WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_GRAPH_API_VERSION=v25.0
WHATSAPP_REVIEW_TEMPLATE_NAME=nouvel_avis_client
WHATSAPP_REVIEW_TEMPLATE_LANGUAGE=fr

KKIAPAY_API_URL=https://api.kkiapay.me
KKIAPAY_PUBLIC_KEY=
KKIAPAY_PRIVATE_KEY=
KKIAPAY_SECRET_KEY=
KKIAPAY_SANDBOX=true
```

`JWT_SECRET` peut rester dans `.env`, mais il peut aussi être stocké dans le coffre chiffré local.

## Secrets chiffrés

Les secrets plateforme suivants peuvent être stockés localement sous forme chiffrée :

```text
jwtSecret
whatsappAccessToken
whatsappWebhookVerifyToken
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
Nom du secret a chiffrer: jwtSecret
Valeur à chiffrer: test_xxxxx
```

### Lister les secrets masqués

```bash
npm run secret:list
```

L'application lit d'abord `storage/secrets`, puis retombe sur `.env` si nécessaire.

## WhatsApp Cloud API

Le backend envoie les notifications via l'API officielle Meta WhatsApp Cloud API.
Le `phone number id` reste en `.env` :

```env
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789
WHATSAPP_GRAPH_API_VERSION=v25.0
WHATSAPP_REVIEW_TEMPLATE_NAME=nouvel_avis_client
WHATSAPP_REVIEW_TEMPLATE_LANGUAGE=fr
```

Les secrets WhatsApp doivent etre stockes dans le coffre chiffre :

```text
whatsappAccessToken
whatsappWebhookVerifyToken
```

Si `whatsappAccessToken` ou `WHATSAPP_PHONE_NUMBER_ID` n'est pas configure,
l'application passe en mode log/mock.

Pour creer le template de notification d'avis via l'API Meta :

```bash
npm run whatsapp:template:create
```

La commande cree par defaut `nouvel_avis_client` en `fr`. Elle utilise `WHATSAPP_BUSINESS_ACCOUNT_ID`
ou tente de le resoudre depuis `WHATSAPP_PHONE_NUMBER_ID`.

Les notifications d'avis utilisent ce template Meta valide, avec trois variables :

```text
{{1}} Nom de l'entreprise
{{2}} Note client
{{3}} Detail de l'avis
```

Un retour API `queued` signifie que Meta a accepte la requete. La livraison reelle est confirmee
ensuite via les webhooks de statut (`sent`, `delivered`, `read`, `failed`). Une erreur `code 190`
indique generalement un token WhatsApp invalide ou expire : mettez a jour le secret
`whatsappAccessToken`.

Pour savoir si un message WhatsApp est reellement envoye, Meta renvoie les statuts
sur le webhook suivant :

```text
GET /api/webhooks/whatsapp
POST /api/webhooks/whatsapp
POST /api/webhooks/whatsapp/status
```

Configurez une URL publique accessible par Meta :

```env
BACKEND_URL=https://votre-domaine.com
```

En local, utilisez une URL publique de tunnel, par exemple ngrok. Le credit WhatsApp est decompte
une seule fois lorsque Meta confirme `sent`, `delivered` ou `read`. Les statuts `failed`
ne consomment pas de credit.

## Seed de donnees pour l'analyse IA

Un seeder permet de creer un jeu de 1000 avis realistes pour tester le dashboard, les filtres,
Typesense et l'analyse IA.

```bash
npm run seed:ai-reviews
```

Le script cherche un QR Code avec le numero :

```text
+22999997478
```

S'il existe, il l'utilise. Sinon, il cree un QR Code associe a la premiere entreprise utilisateur
trouvee. Les avis generes couvrent plusieurs sujets utiles pour l'analyse :

- temps d'attente ;
- accueil et service ;
- qualite du service ;
- prix ;
- disponibilite ;
- paiement ;
- proprete ;
- experiences positives.

Important : ce seeder ne declenche aucun envoi WhatsApp ou email. Il insere directement les avis
avec `Review.insertMany`, sans passer par la logique de notification, et marque les statuts en
`skipped`.

Pour remplacer les avis precedemment generes par ce seeder :

```bash
npm run seed:ai-reviews -- --reset
```

Pour eviter la reindexation Typesense pendant le seed :

```bash
npm run seed:ai-reviews -- --skip-index
```

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
- `POST /api/payments/:id/verify` : verification serveur apres retour prestataire
- `POST /api/payments/:id/confirm` : confirmation manuelle/admin avec `x-payment-secret`
- `POST /api/webhooks/whatsapp` : callback de statut WhatsApp Cloud API

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
- Gardez `paymentConfirmSecret` uniquement comme mécanisme admin/fallback.

