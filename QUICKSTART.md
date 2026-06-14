# 🚀 Guide de démarrage rapide - Telegram

## 5 minutes pour mettre en place Telegram

### Étape 1: Créer le bot (2 min)

1. Ouvrez Telegram
2. Cherchez **@BotFather**
3. Envoyez `/newbot`
4. Nom du bot: `QrFeedback`
5. Username unique: `QrFeedbackBot` (ou `YourName_QrFeedbackBot`)

✅ BotFather vous donne un **TOKEN**. Exemple:

```
123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

### Étape 2: Configurer le serveur (3 min)

#### Option A: Variable d'environnement (Développement)

Ajouter à votre `.env`:

```env
TELEGRAM_BOT_TOKEN=your-token-here
```

#### Option B: Sauvegarder en secret (Production)

```bash
npm run secret:set
# Entrez: telegramBotToken
# Valeur: your-token
```

### Étape 3: Démarrer

```bash
npm run dev
```

Le bot est maintenant actif! 🎉

### Étape 4: Tester (30 sec)

1. Allez sur Telegram
2. Cherchez votre bot (@YourName_QrFeedbackBot)
3. Tapez `/start`
4. Le menu s'affiche!

## Configuration webhook (Production)

Si vous utilisez HTTPS avec webhooks:

```bash
# Ajouter à .env
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/api/webhooks/telegram/webhook

# Puis configurer
npm run telegram:setup
```

## Intégration dans les vues Vue

### Ajouter les préférences de notification

```vue
<template>
  <div>
    <NotificationPreferences />
  </div>
</template>

<script setup>
import NotificationPreferences from "@/components/NotificationPreferences.vue";
</script>
```

### Ajouter le bouton de connexion Telegram

```vue
<template>
  <div>
    <TelegramConnection />
  </div>
</template>

<script setup>
import TelegramConnection from "@/components/TelegramConnection.vue";
</script>
```

## Commandes disponibles dans le bot

| Commande        | Fonction             |
| --------------- | -------------------- |
| `/start`        | Menu principal       |
| `/help`         | Voir les commandes   |
| `/create_qr`    | Créer un QR code     |
| `/my_qr_codes`  | Lister vos QR codes  |
| `/reviews`      | Voir vos avis        |
| `/search texte` | Chercher des avis    |
| `/settings`     | Gérer vos paramètres |

## Envoyer des notifications par Telegram

### Automatiquement via préférences

```typescript
import { sendReviewNotification } from "@/services/notification.service";

await sendReviewNotification({
  user: userData,
  company: companyData,
  review: reviewData,
});
// Utilise le canal préféré de l'utilisateur!
```

### Forcer Telegram spécifiquement

```typescript
await sendReviewNotification({
  user: userData,
  company: companyData,
  review: reviewData,
  channel: "telegram", // Force Telegram
});
```

## Vérifier que tout fonctionne

```bash
# Vérifier les types
npm run type-check

# Voir les logs
npm run dev

# Si vous avez des erreurs, voir:
# - TELEGRAM_SETUP.md (Configuration détaillée)
# - INTEGRATION_SUMMARY.md (Fichiers modifiés)
```

## ❓ Problèmes courants

### "Bot ne répond pas"

- Vérifiez le TOKEN
- Redémarrez le serveur: `npm run dev`
- Vérifiez le chemin du bot: `https://t.me/VotreBot`

### "Token introuvable"

- Utilisez: `npm run secret:list`
- Ou vérifiez votre `.env`

### "Erreur lors de la création du QR"

- Vérifiez la DB (MongoDB)
- Vérifiez les permissions des fichiers

### "Webhook n'est pas activé"

- Assurez-vous HTTPS
- Vérifiez le domaine public
- Lancez: `npm run telegram:setup`

## 📚 Documentation complète

- **TELEGRAM_SETUP.md** - Guide d'installation complet
- **INTEGRATION_SUMMARY.md** - Résumé des changements

---

**Statut**: ✅ Prêt à l'emploi!
**Questions?**: Consultez les fichiers de documentation
