#!/usr/bin/env tsx

/**
 * Script de configuration du bot Telegram
 *
 * Usage: npm run telegram:setup
 *
 * Ce script:
 * 1. Demande le token du bot
 * 2. Configure le webhook Telegram
 * 3. Enregistre les commandes du bot
 */

import {
  readFileSecret,
  writeFileSecret,
} from "../services/fileSecret.service.js";
import { env } from "../config/env.js";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function setupTelegramBot() {
  console.log("🤖 Configuration du bot Telegram QrFeedback\n");

  try {
    // 1. Obtenir le token du bot
    let botToken = env.telegram.botToken;

    if (!botToken) {
      console.log(
        "❌ Token du bot non trouvé dans les variables d'environnement",
      );
      botToken = await question("\n📝 Entrez votre token Telegram Bot: ");

      if (!botToken) {
        console.error("❌ Token requis");
        process.exit(1);
      }

      // Sauvegarder le token
      await writeFileSecret("telegramBotToken", botToken);
      console.log("✅ Token sauvegardé");
    }

    // 2. Tester la connexion avec le bot
    console.log("\n🔍 Test de connexion au bot...");
    const testResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getMe`,
    );
    const botInfo = await testResponse.json();

    if (!botInfo.ok) {
      console.error(
        "❌ Erreur lors de la connexion au bot:",
        botInfo.description,
      );
      process.exit(1);
    }

    console.log(`✅ Bot connecté: @${botInfo.result.username}`);
    console.log(`   ID: ${botInfo.result.id}`);
    console.log(`   Nom: ${botInfo.result.first_name}`);

    // 3. Configurer le webhook (optionnel)
    const webhookUrl =
      env.telegram.webhookUrl ||
      env.backendUrl + "/api/webhooks/telegram/webhook";

    if (webhookUrl) {
      console.log("\n🔗 Configuration du webhook...");
      const webhookResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
          }),
        },
      );

      const webhookResult = await webhookResponse.json();
      if (webhookResult.ok) {
        console.log(`✅ Webhook configuré: ${webhookUrl}`);
      } else {
        console.warn(
          "⚠️  Erreur lors de la configuration du webhook:",
          webhookResult.description,
        );
      }
    }

    // 4. Enregistrer les commandes du bot
    console.log("\n📋 Enregistrement des commandes du bot...");

    const commands = [
      { command: "start", description: "Démarrer et voir le menu principal" },
      { command: "help", description: "Voir les commandes disponibles" },
      { command: "create_qr", description: "Créer un nouveau QR code" },
      { command: "my_qr_codes", description: "Voir mes QR codes" },
      { command: "reviews", description: "Voir mes avis récents" },
      { command: "search", description: "Rechercher des avis" },
      { command: "settings", description: "Gérer mes paramètres" },
    ];

    const commandsResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/setMyCommands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      },
    );

    const commandsResult = await commandsResponse.json();
    if (commandsResult.ok) {
      console.log("✅ Commandes enregistrées");
    } else {
      console.warn(
        "⚠️  Erreur lors de l'enregistrement des commandes:",
        commandsResult.description,
      );
    }

    // 5. Résumé
    console.log("\n✨ Configuration terminée!\n");
    console.log("Votre bot est prêt à être utilisé:");
    console.log(`  • Recherchez @${botInfo.result.username} sur Telegram`);
    console.log(`  • Ou visitez: https://t.me/${botInfo.result.username}`);
    console.log("\nCommandes disponibles:");
    commands.forEach((cmd) => {
      console.log(`  • /${cmd.command} - ${cmd.description}`);
    });

    rl.close();
  } catch (error) {
    console.error("❌ Erreur:", error);
    rl.close();
    process.exit(1);
  }
}

setupTelegramBot();
