# 🤖 Guide d'intégration Telegram - QrFeedback

Ce guide vous explique comment configurer et utiliser le bot Telegram QrFeedback dans votre application.

## 📋 Table des matières

1. [Prérequis](#prérequis)
2. [Créer le bot](#créer-le-bot)
3. [Configuration du serveur](#configuration-du-serveur)
4. [Tester le bot](#tester-le-bot)
5. [Fonctionnalités utilisateur](#fonctionnalités-utilisateur)
6. [Dépannage](#dépannage)

## Prérequis

- Node.js 18+
- Un compte Telegram
- L'accès à BotFather sur Telegram
- Un domaine public (pour les webhooks)

## Créer le bot

### Étape 1: Créer un bot avec BotFather

1. Ouvrez Telegram et recherchez **@BotFather**
2. Démarrez une conversation (`/start`)
3. Tapez `/newbot` et suivez les instructions:
   - Donnez un nom: `QrFeedback`
   - Donnez un username unique: `QrFeedback_Bot` (ou votre choix)

4. BotFather vous donnera un **token**. Sauvegardez-le!

Exemple de token:

```
123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

### Étape 2: Configurer le bot sur Telegram

Optionnel mais recommandé:

```
/setprivacy → Sélectionnez le bot → Enable
/setjoingroups → Sélectionnez le bot → Disable
/setinline → Sélectionnez le bot → Disable
```

## Configuration du serveur

### Étape 1: Ajouter les variables d'environnement

Créez un fichier `.env.telegram` ou ajouter à votre `.env`:

```env
# Bot Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_WEBHOOK_URL=https://votre-domaine.com/api/webhooks/telegram/webhook
TELEGRAM_WEBAPP_URL=https://votre-app.com
```

### Étape 2: Sauvegarder le token de manière sécurisée

Utilisez le script de gestion des secrets:

```bash
npm run secret:set
```

Entrez:

- Nom du secret: `telegramBotToken`
- Valeur: `votre-token-telegram`

Ou directement en variable d'environnement:

```bash
TELEGRAM_BOT_TOKEN=votre-token
```

### Étape 3: Configurer le bot

Lancez le script de setup:

```bash
npm run telegram:setup
```

Ce script:

- ✅ Teste la connexion au bot
- ✅ Configure le webhook
- ✅ Enregistre les commandes

## Tester le bot

### Mode développement (Polling)

Le mode polling est activé par défaut en développement (plus simple, pas besoin de webhook).

1. Démarrez le serveur:

```bash
npm run dev
```

2. Recherchez votre bot sur Telegram (@QrFeedback_Bot)

3. Tapez `/start`

4. Le bot devrait répondre!

### Mode production (Webhooks)

Pour la production, utilisez les webhooks:

1. Assurez-vous que `TELEGRAM_WEBHOOK_URL` pointe vers votre domaine public
2. Lancez `npm run telegram:setup`
3. Le webhook sera automatiquement configuré

## Fonctionnalités utilisateur

### Commandes disponibles

| Commande          | Description                         |
| ----------------- | ----------------------------------- |
| `/start`          | Affiche le menu principal           |
| `/help`           | Affiche l'aide et les commandes     |
| `/create_qr`      | Crée un nouveau QR code             |
| `/my_qr_codes`    | Liste vos QR codes                  |
| `/reviews`        | Affiche vos avis récents            |
| `/search [texte]` | Recherche des avis similaires       |
| `/settings`       | Gère vos paramètres de notification |

### Menu interactif

Le bot offre un menu interactif avec des boutons:

- ➕ Créer un QR code
- 📋 Mes QR codes
- ⭐ Mes avis
- 🔍 Rechercher
- ⚙️ Paramètres

### Notif notifications

Les utilisateurs peuvent configurer Telegram comme canal de notification préféré:

- 📧 Email
- 💬 WhatsApp
- 📱 Telegram

## Connexion utilisateur

### Processus de connexion

1. L'utilisateur tape `/start` dans le bot
2. Si pas connecté, un bouton "Se connecter sur le site" s'affiche
3. L'utilisateur clique et accède à son dashboard
4. Accès à la section "Préférences de notification"
5. Clique sur "Se connecter à Telegram"
6. Redirection vers le bot avec token de connexion
7. Bot confirme la connexion

### API de connexion

```typescript
// Connecter un utilisateur à Telegram
POST /api/webhooks/telegram/connect
{
  "userId": "user-id",
  "chatId": 123456789,
  "username": "user_telegram",
  "firstName": "John"
}
```

## Gestion des préférences de notification

### API - Obtenir les préférences

```bash
GET /api/notifications/preferences
Headers: Authorization: Bearer {token}

Response:
{
  "ok": true,
  "preferences": {
    "channels": {
      "email": true,
      "whatsapp": false,
      "telegram": true
    },
    "preferredChannel": "telegram"
  }
}
```

### API - Mettre à jour les préférences

```bash
PUT /api/notifications/preferences
Headers: Authorization: Bearer {token}
Content-Type: application/json

{
  "channels": {
    "email": true,
    "whatsapp": false,
    "telegram": true
  },
  "preferredChannel": "telegram"
}
```

### API - Obtenir le profil Telegram

```bash
GET /api/notifications/telegram-profile
Headers: Authorization: Bearer {token}

Response:
{
  "ok": true,
  "telegramProfile": {
    "chatId": "123456789",
    "username": "john_doe",
    "firstName": "John",
    "connectedAt": "2024-06-14T10:30:00Z",
    "isActive": true
  }
}
```

## Envoi de notifications

### Configuration pour les avis

Quand un nouvel avis est reçu:

```typescript
import { sendReviewNotification } from "./services/notification.service";

// Envoyer au canal préféré
await sendReviewNotification({
  user: userData,
  company: companyData,
  review: reviewData,
});

// Ou spécifier un canal
await sendReviewNotification({
  user: userData,
  company: companyData,
  review: reviewData,
  channel: "telegram",
});
```

### Format des notifications Telegram

Les notifications incluent:

- ⭐ Note de l'avis (1-5)
- 💬 Commentaire du client
- 📌 Réponses aux questions personnalisées
- 📅 Date de l'avis

Exemple:

```
📝 Nouvel avis pour Mon Restaurant

⭐ Note: 4/5

💬 Expérience: Service rapide et courtois

📌 Qualité de la nourriture: Excellente
📌 Ambiance: Agréable
```

## Dépannage

### Le bot ne répond pas

**Vérification:**

1. Le token est-il correct?

```bash
npm run secret:list | grep telegram
```

2. Le bot est-il en ligne?

```bash
curl https://api.telegram.org/botVOTRE_TOKEN/getMe
```

3. Le polling/webhook est-il activé?

- Vérifiez les logs du serveur

### Erreur: "Bot token was not provided"

Solution:

```bash
npm run secret:set
# Entrez: telegramBotToken
# Valeur: votre-token
```

### Webhook ne fonctionne pas

**Vérification:**

1. Le domaine est-il publique?
2. HTTPS est-il activé?
3. Le port 443 est-il accessible?

Tester:

```bash
curl https://votre-domaine.com/api/webhooks/telegram/webhook
# Devrait répondre 404 ou 405, pas timeout
```

### Les notifications ne sont pas envoyées

1. Vérifiez que Telegram est activé:

```bash
db.users.findOne({ _id: userId }, { notificationPreferences: 1 })
```

2. Vérifiez que le chatId est sauvegardé:

```bash
db.users.findOne({ _id: userId }, { telegramProfile: 1 })
```

3. Vérifiez les logs du serveur pour les erreurs Telegram

### Le bot refuse la connexion

Vérifiez:

1. Chat ID est valide
2. Utilisateur existe en base de données
3. Token de bot est valide

## Scripts utiles

```bash
# Configuration du bot
npm run telegram:setup

# Afficher le token (si stocké en secret)
npm run secret:list

# Ajouter/modifier un secret
npm run secret:set

# Vérifier les types TypeScript
npm run type-check
```

## Modèles de données

### User.telegramProfile

```typescript
{
  chatId: string;           // ID unique Telegram
  username?: string;        // Username Telegram (@username)
  firstName?: string;       // Prénom
  lastName?: string;        // Nom
  connectedAt: Date;        // Quand connecté
  isActive: boolean;        // Actif ou non
}
```

### User.notificationPreferences

```typescript
{
  channels: {
    email: boolean; // Email activé
    whatsapp: boolean; // WhatsApp activé
    telegram: boolean; // Telegram activé
  }
  preferredChannel: "email" | "whatsapp" | "telegram"; // Canal préféré
}
```

## Variables d'environnement

| Variable               | Description      | Requis                      |
| ---------------------- | ---------------- | --------------------------- |
| `TELEGRAM_BOT_TOKEN`   | Token du bot     | ✅                          |
| `TELEGRAM_WEBHOOK_URL` | URL du webhook   | ❌ (optionnel pour polling) |
| `TELEGRAM_WEBAPP_URL`  | URL de l'app web | ❌                          |

## Ressources

- [Documentation Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bot Best Practices](https://core.telegram.org/bots/features)
- [Node Telegram Bot API](https://github.com/yagop/node-telegram-bot-api)

## Support

Pour toute question ou problème:

1. Vérifiez les logs du serveur
2. Consultez le [dépannage](#dépannage)
3. Ouvrez une issue sur le repository

---

**Dernière mise à jour:** 2024-06-14
