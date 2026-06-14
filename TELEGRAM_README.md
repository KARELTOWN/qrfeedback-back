# 🤖 Intégration Telegram - QrFeedback

## Vue d'ensemble

QrFeedback est maintenant intégré avec Telegram! Les utilisateurs peuvent:

- Recevoir les notifications d'avis par Telegram
- Gérer leurs QR codes directement via le bot
- Consulter leurs avis en temps réel
- Configurer leur canal de notification préféré

## 📱 Fonctionnalités

### Pour les utilisateurs

- ✅ Se connecter avec Telegram
- ✅ Choisir le canal de notification (Email, WhatsApp, Telegram)
- ✅ Créer des QR codes depuis le bot
- ✅ Voir l'historique des avis
- ✅ Rechercher des avis similaires
- ✅ Gérer les paramètres depuis le bot

### Bot Telegram

- 🤖 Menu interactif avec boutons
- 📋 Commandes complètes (`/start`, `/help`, etc.)
- 📊 Statistiques des avis
- 🔍 Recherche intégrée (Typesense)
- ⏰ Notifications en temps réel

## 🚀 Démarrage rapide

### 1. Obtenir un token Telegram

```
1. Ouvrir Telegram
2. Chercher @BotFather
3. Envoyer /newbot
4. Suivre les instructions
5. Copier le TOKEN
```

### 2. Configurer votre serveur

```bash
# Ajouter à .env
TELEGRAM_BOT_TOKEN=your-token-here

# Ou via secret
npm run secret:set
# telegramBotToken → your-token
```

### 3. Démarrer

```bash
npm run dev
```

### 4. Tester

Rechercher votre bot sur Telegram et taper `/start`

## 📁 Structure du code

### Backend (`src/`)

```
services/
├── telegram.service.ts        # Envoi de messages
├── telegramBot.service.ts     # Logique du bot
└── notification.service.ts    # Multi-canal

controllers/
├── notification.controller.ts
└── telegramWebhook.controller.ts

routes/
├── notification.routes.ts
└── telegram.routes.ts
```

### Frontend (`src/components/`)

```
├── NotificationPreferences.vue  # Gestion canaux
└── TelegramConnection.vue       # Connexion bot
```

## 🔌 API Endpoints

### Préférences de notification

```
GET    /api/notifications/preferences          # Obtenir les préférences
PUT    /api/notifications/preferences          # Mettre à jour
GET    /api/notifications/telegram-profile     # Profil Telegram
POST   /api/notifications/telegram-disconnect  # Déconnecter
```

### Webhooks

```
POST   /api/webhooks/telegram/webhook          # Webhook (prod)
POST   /api/webhooks/telegram/connect          # Connexion utilisateur
```

## 🎮 Commandes du bot

| Commande        | Description            |
| --------------- | ---------------------- |
| `/start`        | Menu principal         |
| `/help`         | Aide et commandes      |
| `/create_qr`    | Créer un QR code       |
| `/my_qr_codes`  | Lister vos QR codes    |
| `/reviews`      | Voir vos avis          |
| `/search texte` | Chercher dans vos avis |
| `/settings`     | Gérer vos paramètres   |

## 🔐 Modèles de données

### User (mis à jour)

```typescript
notificationPreferences: {
  channels: {
    email: boolean,
    whatsapp: boolean,
    telegram: boolean
  },
  preferredChannel: 'email' | 'whatsapp' | 'telegram'
}

telegramProfile: {
  chatId: string,
  username?: string,
  firstName?: string,
  lastName?: string,
  connectedAt: Date,
  isActive: boolean
}
```

## 📊 Flux d'utilisation

### 1. Connexion utilisateur

```
Utilisateur → /start sur le bot
           → Clique "Se connecter"
           → Login sur le site
           → Paramètres → Connecter Telegram
           → Retour au bot
           → ✅ Connecté!
```

### 2. Notification d'avis

```
Nouvel avis → Système vérifie préférence utilisateur
          → Envoie par Email/WhatsApp/Telegram
          → Utilisateur reçoit notification
```

## ⚙️ Configuration

### Développement

```env
NODE_ENV=development
TELEGRAM_BOT_TOKEN=your-token
# Utilise polling (plus simple)
```

### Production

```env
NODE_ENV=production
TELEGRAM_BOT_TOKEN=your-token
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/api/webhooks/telegram/webhook
# Utilise webhooks (plus robuste)
```

## 🔧 Scripts utiles

```bash
# Configuration initiale du bot
npm run telegram:setup

# Voir les secrets
npm run secret:list

# Ajouter un secret
npm run secret:set

# Valider TypeScript
npm run type-check

# Développement
npm run dev

# Build production
npm run build
npm run start
```

## 📚 Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** - Démarrage en 5 minutes
- **[TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md)** - Guide complet
- **[INTEGRATION_SUMMARY.md](./INTEGRATION_SUMMARY.md)** - Changements effectués

## 🐛 Dépannage

### Le bot ne répond pas

- ✅ Vérifier le TOKEN
- ✅ Redémarrer le serveur
- ✅ Vérifier la connexion Internet
- ✅ Voir les logs: `npm run dev`

### Notifications non reçues

- ✅ Vérifier que Telegram est activé dans les préférences
- ✅ Vérifier que le chatId est sauvegardé
- ✅ Vérifier les logs du bot

### Erreur "Token introuvable"

- ✅ Ajouter TELEGRAM_BOT_TOKEN au .env
- ✅ Ou utiliser: `npm run secret:set`

## 🎯 Prochaines améliorations possibles

- [ ] Groupes Telegram (notifications en groupe)
- [ ] Inline mode (recherche depuis chat)
- [ ] Commandes vocales
- [ ] Partage d'avis amélioré
- [ ] Analytics dans le bot
- [ ] Intégration avec d'autres services

## 🤝 Contributions

Pour améliorations ou bug reports:

1. Vérifier la documentation
2. Consulter les logs
3. Créer une issue

## 📞 Support

Pour toute aide:

1. 📖 Consulter [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md)
2. 🔍 Chercher dans [QUICKSTART.md](./QUICKSTART.md)
3. 📋 Voir [INTEGRATION_SUMMARY.md](./INTEGRATION_SUMMARY.md)

## ✅ Checklist de déploiement

- [ ] Token Telegram obtenu
- [ ] .env configuré
- [ ] npm run dev fonctionne
- [ ] Bot répond à /start
- [ ] Composants Vue intégrés
- [ ] Tests TypeScript passent
- [ ] Documentation lue

---

**Statut**: ✅ Prêt pour la production!

**Version**: 1.0.0
**Date**: 2024-06-14
**Auteur**: QrFeedback Team
