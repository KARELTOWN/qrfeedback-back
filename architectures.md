# Regles d'architecture - Opinbase

Statut: document de reference pour le backend `back/` et le frontend `front/`.
Toute nouvelle fonctionnalite doit respecter ces regles sauf decision technique explicite.


Ce document fixe les regles a suivre pour le reste du projet. Il couvre le backend Express/TypeScript/Mongoose, le frontend Vue/Vite et les futurs modules CRM, segments, automation, inbox et WhatsApp Cloud API.

## Principes directeurs

- Le produit est WhatsApp-only pour les notifications client et les automations.
- Le SaaS est multi-tenant: toute donnee metier doit etre scopee par `company`.
- Le module Opinbase existant reste stable. Les nouveaux modules doivent s'y brancher sans le refaire.
- Les modules doivent etre extensibles mais pas abstraits sans besoin reel.
- Le code doit rester deployable simplement: build TypeScript, variables d'environnement claires, pas de dependances lourdes sans justification.
- Les donnees sensibles sont chiffrees avant stockage.
- Les operations asynchrones ou longues doivent etre preparees pour jobs/queues, meme si une premiere version reste synchrone.

## Backend

Architecture par couches:

- `routes`: declaration des endpoints et middlewares.
- `validators`: validation d'entree HTTP.
- `controllers`: orchestration HTTP minimale, pas de logique metier.
- `services`: logique metier, workflows, integration entre models.
- `models`: schemas Mongoose, index, enums proches de la persistence.
- `jobs`: traitements planifies ou differes.
- `utils`: fonctions pures et helpers transverses.
- `config`: environnement, database, constantes de configuration.

Regles:

- Un controller ne doit pas faire de requetes Mongoose complexes directement.
- Un service peut appeler d'autres services quand il orchestre un workflow metier.
- Un model ne doit pas contenir de logique applicative lourde.
- Tout endpoint authentifie doit utiliser `requireAuth`.
- Toute requete tenant-aware doit filtrer par `company`.
- Les suppressions metier doivent preferer `archivedAt` sauf donnees purement cachees.
- Les historiques et logs doivent etre append-only autant que possible.

## Multi-tenant

Toute collection metier liee a une entreprise doit avoir:

- `company: ObjectId ref Company`
- un index sur `company`
- des requetes filtrees par `company`

Les services ne doivent jamais accepter un `companyId` venu du body pour les actions utilisateur authentifiees. Ils utilisent `req.company` ou un objet `Company` resolu cote serveur.

## Contacts, listes et segments

Les contacts sont dedoublonnes dans cet ordre:

1. `company + whatsappNormalized`
2. `company + phoneNormalized`
3. `company + emailNormalized`

Regles:

- Ne pas creer un doublon si un contact existe deja avec un identifiant normalise.
- Ne pas ecraser les donnees importantes deja presentes si la nouvelle valeur est vide ou moins fiable.
- Fusionner les tags.
- Conserver l'historique des feedbacks, messages et activites.
- Les segments dynamiques stockent leurs regles et peuvent recalculer un cache `segment_memberships`.
- Les segments statiques stockent leurs membres via `segment_memberships`.

## Opinbase

Le Opinbase reste la source principale des soumissions.

Flow attendu:

1. Creation du `Review`.
2. Resolution du mapping QR form -> liste.
3. Fallback vers `Liste par defaut` si aucun mapping n'existe.
4. `upsertContact`.
5. Ajout du contact a la liste.
6. Notification WhatsApp si applicable.
7. Plus tard: dispatch automation `feedback_submitted`.

## WhatsApp Cloud API


Regles:

- Etat actuel: une configuration WhatsApp Cloud API plateforme est lue depuis l'environnement et le coffre chiffre.
- Evolution multi-tenant: chaque entreprise configure son propre WhatsApp Business via `company_whatsapp_configs`.
- A terme, les messages partent depuis le `phoneNumberId` de l'entreprise.
- Le `WHATSAPP_PHONE_NUMBER_ID` vient de l'environnement.
- Le `WHATSAPP_ACCESS_TOKEN` vient de l'environnement ou du coffre chiffre `whatsappAccessToken`.
- Les tokens sont chiffres avec `encryptSecret` quand ils sont stockes par l'application.
- Les statuts sont traites via webhook Meta sur `/api/webhooks/whatsapp`.
- Le SaaS orchestre l'envoi, l'inbox et les logs, mais ne supporte pas les couts Meta des entreprises.

## Automation

Le futur moteur automation doit rester decouple:

- triggers
- conditions
- delays
- actions
- executions
- execution logs

Chaque execution doit avoir un snapshot de contexte. Les erreurs doivent etre historisees. Les actions externes doivent etre idempotentes autant que possible.

## Jobs et scalabilite

Premiere version acceptable:

- jobs synchrones ou planifies avec `node-cron` pour les traitements simples.

Evolution recommandee:

- queue dediee pour delays, retries et traitements volumineux.
- jobs idempotents.
- verrous ou dedupe keys pour eviter les doubles executions.

Implementation actuelle :

- Redis + BullMQ assurent l'execution hors requete des notifications, indexations et taches planifiees.
- MongoDB contient une outbox (`outboxevents`) avant toute publication dans Redis. Chaque evenement
  a une cle d'idempotence, un statut et les erreurs/tentatives necessaires au rejeu.
- Le processus `npm run worker` traite l'outbox et porte les jobs recurrents (campagnes Telegram,
  rapports hebdomadaires et reprise de l'outbox). L'API ne doit pas lancer ces schedulers.
- L'etat de conversation Telegram est stocke dans Redis avec expiration, et non dans la RAM HTTP.
- Les futures automations WhatsApp/Telegram publient un evenement `automation.trigger` dans l'outbox;
  elles ne doivent jamais executer un appel externe directement depuis un controller.

## Modèles de notification

- Les modèles e-mail/SMS plateforme sont stockés dans `notificationtemplates`, jamais codés dans un controller.
- Les modèles déclarent les variables admises. La syntaxe est `#variable` et la substitution est effectuée
  juste avant le rendu/envoi.
- Le HTML e-mail administrable est rendu dans une enveloppe Pug commune avec le titre et le corps injectés.
- Le SMS est prêt au niveau modèle et prévisualisation, mais le transport SMS n'est pas encore implémenté.
- La gestion de ces modèles est réservée au superadministrateur. L'éditeur frontend recommandé est SunEditor.

Tout traitement qui peut devenir long doit etre isole dans un service/job, jamais enfoui dans un controller.

## Frontend

Le frontend Vue doit suivre une architecture simple:

- `views`: pages.
- `components`: composants reutilisables.
- `composables`: appels API et logique UI reutilisable.
- `validators`: schemas de validation front.
- `constants`: options partagees.

Regles:

- Les pages ne doivent pas contenir toute la logique API.
- Les appels API passent par `src/api.ts`.
- Les types de payload/API sont declares dans les composables proches de leur usage.
- Les interfaces metier doivent rester WhatsApp-only sauf decision produit contraire explicite.

## API

Regles:

- Reponses JSON coherentes: objet racine nomme (`{ segment }`, `{ segments, pagination }`, etc.).
- Pagination via `page` et `limit`.
- Validation avant controller.
- Erreurs metier via `HttpError`.
- Les endpoints de mutation doivent etre idempotents quand c'est naturel (`upsert`, mappings, configs).

## Donnees et index

Chaque model important doit definir:

- index de tenant: `{ company: 1 }`
- index de listing: souvent `{ company: 1, updatedAt: -1 }`
- index uniques partiels pour les identifiants normalises quand necessaire.

Les index doivent correspondre aux requetes reelles. Ne pas ajouter d'index decoratifs.

## Securite

- Ne jamais logger les tokens, secrets, mots de passe ou OTP.
- Chiffrer les access tokens WhatsApp.
- Masquer les secrets dans les reponses API.
- Valider les webhooks et garder les payloads importants en logs techniques.
- Ne jamais faire confiance a un `companyId` envoye par le client.

## Tests et verification

Minimum avant de terminer une tache:

- `npm run type-check` backend si le backend a ete touche.
- `npm run type-check` frontend si le frontend a ete touche.
- Verifier les routes et imports avec `rg` quand on renomme/supprime.

Pour les zones critiques, ajouter ou prevoir des tests autour de:

- normalisation contacts
- dedoublonnage
- segments
- webhooks WhatsApp
- automation conditions/actions

