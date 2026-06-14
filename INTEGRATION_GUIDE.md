# 🔗 Guide d'intégration avec les services existants

Ce document explique comment intégrer le service Telegram dans vos services existants.

## 1. Modifier review.service.ts

### Avant (seulement WhatsApp)

```typescript
// review.service.ts (ligne ~100)
import { sendWhatsapp } from './whatsapp.service.js'

async function notifyByWhatsapp(...) {
  // Envoyer par WhatsApp
}

// Dans createReview()
await notifyByWhatsapp(company, review, qrCode)
```

### Après (multi-canal)

```typescript
// review.service.ts (mise à jour)
import { sendReviewNotification } from "./notification.service.js";

// Dans createReview()
const user = await User.findById(company.userId); // Adapter selon votre structure
await sendReviewNotification({
  user,
  company,
  review,
});
```

## 2. Importer dans vos contrôleurs

### Récupérer les préférences de l'utilisateur

```typescript
import { getPreferredChannel } from "@/services/notification.service";

// Dans un contrôleur
const preferredChannel = getPreferredChannel(user);
console.log(preferredChannel); // 'email' | 'whatsapp' | 'telegram'
```

### Envoyer des notifications

```typescript
import {
  sendReviewNotification,
  broadcastReviewNotification,
} from "@/services/notification.service";

// Envoyer au canal préféré
await sendReviewNotification({ user, company, review });

// Envoyer à tous les canaux activés
const results = await broadcastReviewNotification({ user, company, review });
```

## 3. Utiliser dans les routes existantes

### Exemple: Route création d'avis

```typescript
// routes/review.routes.ts
import { sendReviewNotification } from "../services/notification.service.js";

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const review = new Review(req.body);
    await review.save();

    // NOUVEAU: Envoyer la notification
    const user = await User.findById(req.user._id);
    await sendReviewNotification({
      user,
      company: req.company,
      review,
    });

    res.json({ ok: true, review });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## 4. Intégrer dans les composants Vue

### Dans le dashboard utilisateur

```vue
<template>
  <div class="user-dashboard">
    <h1>Mon tableau de bord</h1>

    <!-- Nouvelles préférences de notification -->
    <section class="settings">
      <NotificationPreferences />
    </section>

    <!-- Connexion Telegram -->
    <section class="telegram">
      <TelegramConnection />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import NotificationPreferences from "@/components/NotificationPreferences.vue";
import TelegramConnection from "@/components/TelegramConnection.vue";

// Votre code existant...
</script>
```

## 5. Étapes de migration

### Step 1: Adapter review.service.ts

1. Importer `sendReviewNotification`
2. Remplacer les appels WhatsApp directs
3. Passer les bons paramètres

### Step 2: Tester les notifications

```bash
npm run dev

# Créer un avis et vérifier que la notification est envoyée
```

### Step 3: Intégrer les composants Vue

1. Ajouter `NotificationPreferences.vue` au dashboard
2. Ajouter `TelegramConnection.vue` aux paramètres

### Step 4: Tester l'interface

1. Accéder au dashboard utilisateur
2. Changer le canal de notification
3. Créer un avis et vérifier la réception

## 6. API pour les préférences

### Récupérer

```typescript
const response = await fetch("/api/notifications/preferences", {
  credentials: "include",
});
const { preferences } = await response.json();
```

### Mettre à jour

```typescript
await fetch("/api/notifications/preferences", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    channels: {
      email: true,
      whatsapp: false,
      telegram: true,
    },
    preferredChannel: "telegram",
  }),
});
```

### Connecter Telegram

```typescript
const response = await fetch("/api/notifications/telegram-profile", {
  credentials: "include",
});
const { telegramProfile } = await response.json();
if (telegramProfile?.isActive) {
  // L'utilisateur est connecté
}
```

## 7. Gestion des erreurs

### Exemple complet avec gestion d'erreur

```typescript
import { sendReviewNotification } from "@/services/notification.service";

async function notifyUser(user, company, review) {
  try {
    const result = await sendReviewNotification({
      user,
      company,
      review,
    });

    if (result.status === "sent") {
      console.log(`✅ Notification envoyée par ${result.channel}`);
    } else if (result.status === "skipped") {
      console.log(`⏭️ Notification skippée: ${result.error}`);
    } else {
      console.error(`❌ Erreur: ${result.error}`);
    }
  } catch (error) {
    console.error("Erreur lors de l'envoi:", error);
    // Gérer l'erreur...
  }
}
```

## 8. Types TypeScript

### Importer les types

```typescript
import type {
  NotificationChannelType,
  NotificationStatus,
} from "@/services/notification.service";

// Utiliser dans vos fonctions
function handleNotification(channel: NotificationChannelType) {
  // 'email' | 'whatsapp' | 'telegram'
}
```

## 9. Vérifier l'intégration

### Logs à vérifier

```bash
# Lors du démarrage
[telegram:bot:initialized]

# À chaque notification
[notification:send:start]   channel: 'telegram'
[notification:send:success]
```

### Tests unitaires (optionnel)

```typescript
import { getPreferredChannel } from "@/services/notification.service";
import { User } from "@/models/User";

describe("notification.service", () => {
  it("should return preferred channel", () => {
    const user = {
      notificationPreferences: {
        channels: { email: true, telegram: false },
        preferredChannel: "email",
      },
    };
    expect(getPreferredChannel(user)).toBe("email");
  });
});
```

## 10. Configuration par environnement

### Développement (.env.local)

```env
TELEGRAM_BOT_TOKEN=your-dev-token
# Pas besoin de webhook, utilise polling
```

### Production (.env.production)

```env
TELEGRAM_BOT_TOKEN=your-prod-token
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/api/webhooks/telegram/webhook
```

## ✅ Checklist d'intégration

- [ ] `telegram.service.ts` créé ✅
- [ ] `telegramBot.service.ts` créé ✅
- [ ] `notification.service.ts` créé ✅
- [ ] User model mis à jour ✅
- [ ] Routes ajoutées ✅
- [ ] Composants Vue créés ✅
- [ ] review.service.ts modifié?
- [ ] Autres services modifiés?
- [ ] Tests passent?
- [ ] Documentation lue?

## 📞 Besoin d'aide?

1. **QUICKSTART.md** - Démarrage rapide
2. **TELEGRAM_SETUP.md** - Configuration détaillée
3. **INTEGRATION_SUMMARY.md** - Fichiers modifiés

---

**Dernière mise à jour**: 2024-06-14
