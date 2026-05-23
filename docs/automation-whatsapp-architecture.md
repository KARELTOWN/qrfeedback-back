# Module Automation + WhatsApp Cloud API

Ce document cadre uniquement le futur module automation, la configuration WhatsApp Business par entreprise, l'inbox liee aux messages et l'historique d'execution. Le module QR Feedback existant reste la source d'evenements et ne doit pas etre refait.

## 0. Socle CRM requis pour l'automation

Le backend actuel ne gere pas encore les listes, segments et dossiers. Comme le module automation doit fonctionner comme Brevo, ces objets doivent etre ajoutes avant ou en meme temps que les premiers scenarios.

Objectif produit:
- Chaque entreprise a un dossier par defaut: `Dossier par defaut`.
- Chaque entreprise a une liste par defaut: `Liste par defaut`.
- Un utilisateur peut creer un nombre illimite de dossiers et listes.
- Une liste contient des contacts.
- Une liste peut definir ses propres attributs personnalisables.
- Une liste contient toujours les champs systeme: nom, prenom, email, telephone, whatsapp, note, tags, date de creation, derniere modification.
- Un QR form peut etre associe a une liste.
- Lors de l'association QR form -> liste, les champs du formulaire sont mappes vers les attributs de la liste.
- Si un champ du QR form n'existe pas dans la liste, l'utilisateur peut creer un nouvel attribut au moment du mapping.
- Un contact a une page detail avec ses informations, ses listes, ses tags, ses messages envoyes/recus, son historique et ses activites automation.
- Les segments regroupent dynamiquement des contacts selon des criteres: nouveau contact, avis inferieur a 3, avis frequents, contact inactif, indicatif pays, tag, liste, champ personnalise, etc.

### contact_folders

Dossiers qui rangent les listes.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `name`: string, requis.
- `isDefault`: boolean, default `false`.
- `createdBy`: ObjectId ref `User`.
- timestamps.

Index:
- `{ company: 1, name: 1 }` unique.
- `{ company: 1, isDefault: 1 }`.

### contact_lists

Liste de contacts inspiree de Brevo.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `folder`: ObjectId ref `ContactFolder`, requis, index.
- `name`: string, requis.
- `description`: string.
- `isDefault`: boolean, default `false`.
- `contactCount`: number, default `0`.
- `lastCalculatedAt`: Date.
- `createdBy`: ObjectId ref `User`.
- timestamps.

Index:
- `{ company: 1, folder: 1, name: 1 }` unique.
- `{ company: 1, isDefault: 1 }`.

### contact_list_attributes

Attributs disponibles dans une liste. Les attributs systeme sont crees automatiquement pour chaque liste.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `list`: ObjectId ref `ContactList`, requis, index.
- `key`: string, requis. Ex: `first_name`, `last_name`, `email`, `whatsapp`, `rating`, `favorite_product`.
- `label`: string, requis.
- `type`: enum `text | textarea | email | phone | whatsapp | number | rating | date | boolean | select | multi_select | tag`.
- `isSystem`: boolean, default `false`.
- `isRequired`: boolean, default `false`.
- `isUnique`: boolean, default `false`.
- `options`: array string.
- `defaultValue`: mixed.
- `position`: number.
- timestamps.

Index:
- `{ list: 1, key: 1 }` unique.

Attributs systeme crees par defaut:
- `first_name`
- `last_name`
- `email`
- `phone`
- `whatsapp`
- `rating`
- `tags`
- `created_at`
- `updated_at`

### contacts

Contact global a l'entreprise. Un meme contact peut etre dans plusieurs listes.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `firstName`: string.
- `lastName`: string.
- `email`: string, lowercase, trim.
- `phone`: string.
- `whatsapp`: string.
- `rating`: number.
- `tags`: array string, index.
- `customFields`: mixed. Donnees normalisees par cle d'attribut.
- `source`: enum `manual | import | qr_feedback | automation | api`.
- `lastActivityAt`: Date.
- `lastFeedbackAt`: Date.
- `createdBy`: ObjectId ref `User`.
- timestamps.

Index:
- `{ company: 1, email: 1 }`, sparse.
- `{ company: 1, whatsapp: 1 }`, sparse.
- `{ company: 1, tags: 1 }`.
- `{ company: 1, lastActivityAt: -1 }`.

Regle de dedoublonnage:
- Priorite 1: `company + email`.
- Priorite 2: `company + whatsapp`.
- Priorite 3: `company + phone`.
- Sinon creation d'un nouveau contact.

### contact_list_memberships

Appartenance d'un contact a une liste.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `list`: ObjectId ref `ContactList`, requis, index.
- `contact`: ObjectId ref `Contact`, requis, index.
- `status`: enum `active | unsubscribed | blocked | removed`, default `active`.
- `attributes`: mixed. Valeurs propres a cette liste si necessaire.
- `addedBy`: ObjectId ref `User`.
- `addedByAutomation`: ObjectId ref `Automation`.
- `addedAt`: Date, default now.
- `removedAt`: Date.
- timestamps.

Index:
- `{ list: 1, contact: 1 }` unique.
- `{ company: 1, contact: 1, status: 1 }`.

### contact_tags

Catalogue facultatif de tags par entreprise.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `name`: string, requis.
- `color`: string.
- `createdBy`: ObjectId ref `User`.
- timestamps.

Index:
- `{ company: 1, name: 1 }` unique.

### qr_form_list_mappings

Association entre un QR form et une liste.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `qrCode`: ObjectId ref `CompanyQrCode`, index.
- `list`: ObjectId ref `ContactList`, requis, index.
- `fieldMappings`: array `{ formFieldKey, formFieldLabel, listAttributeKey, listAttributeId, createIfMissing }`.
- `contactIdentityPriority`: array enum `email | whatsapp | phone`.
- `autoCreateContact`: boolean, default `true`.
- `autoAddToList`: boolean, default `true`.
- `createdBy`: ObjectId ref `User`.
- timestamps.

### segments

Segment dynamique de contacts.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `name`: string, requis.
- `description`: string.
- `type`: enum `dynamic | static`, default `dynamic`.
- `rules`: mixed. Groupes de conditions compatibles avec `ConditionEvaluator`.
- `contactCount`: number, default `0`.
- `lastCalculatedAt`: Date.
- `createdBy`: ObjectId ref `User`.
- timestamps.

Index:
- `{ company: 1, name: 1 }` unique.

Exemples de segments:
- Nouveaux contacts: `contact.created_at >= now - 7 jours`.
- Avis negatif: `contact.rating < 3`.
- Avis frequents: `feedback.count >= 3 sur 30 jours`.
- Contacts inactifs: `contact.lastActivityAt < now - 90 jours`.
- Indicatif pays: `contact.whatsapp startsWith +229`.

### segment_memberships

Cache optionnel pour accelerer les segments dynamiques.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `segment`: ObjectId ref `Segment`, requis, index.
- `contact`: ObjectId ref `Contact`, requis, index.
- `matchedAt`: Date.
- `lastEvaluatedAt`: Date.
- timestamps.

Index:
- `{ segment: 1, contact: 1 }` unique.

### contact_activities

Historique visible sur la page detail contact.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `contact`: ObjectId ref `Contact`, requis, index.
- `type`: enum `contact_created | contact_updated | added_to_list | removed_from_list | tag_added | tag_removed | feedback_submitted | message_sent | message_delivered | message_read | message_failed | automation_started | automation_completed | note_created`.
- `title`: string.
- `description`: string.
- `metadata`: mixed.
- `occurredAt`: Date, default now.
- timestamps.

Index:
- `{ company: 1, contact: 1, occurredAt: -1 }`.

## 1. Modele de donnees

Le backend actuel utilise MongoDB avec Mongoose. Les noms ci-dessous correspondent donc a des collections et a des schemas Mongoose, pas a des migrations SQL classiques.

### automations

Scenario d'automation appartenant a une entreprise.

Champs principaux:
- `company`: ObjectId ref `Company`, requis, index.
- `name`: string, requis.
- `description`: string.
- `status`: enum `draft | active | paused | archived`, default `draft`, index.
- `entryPolicy`: enum `allow_multiple | once_per_contact | once_per_contact_per_trigger`, default `allow_multiple`.
- `timezone`: string, default `Africa/Lagos`.
- `version`: number, default `1`.
- `createdBy`: ObjectId ref `User`.
- `updatedBy`: ObjectId ref `User`.
- `publishedAt`: Date.
- `archivedAt`: Date.
- `metadata`: mixed.
- timestamps.

Index conseilles:
- `{ company: 1, status: 1 }`
- `{ company: 1, name: 1 }`

### automation_triggers

Declencheur d'entree d'une automation.

Champs:
- `automation`: ObjectId ref `Automation`, requis, index.
- `company`: ObjectId ref `Company`, requis, index.
- `type`: enum `feedback_submitted | contact_created | contact_updated | contact_added_to_list | contact_entered_segment | rating_below_or_equal | rating_above_or_equal`, requis.
- `config`: mixed. Exemples: `{ "form_id": "...", "rating": 2 }`.
- `enabled`: boolean, default `true`.
- timestamps.

Index:
- `{ company: 1, type: 1, enabled: 1 }`
- `{ automation: 1 }`

### automation_steps

Noeud executable dans le scenario. On garde une structure de graphe simple pour supporter plus tard un builder visuel type Brevo.

Champs:
- `automation`: ObjectId ref `Automation`, requis, index.
- `company`: ObjectId ref `Company`, requis, index.
- `key`: string, requis. Identifiant stable du noeud dans le scenario, ex: `step_1`.
- `type`: enum `condition | delay | action`, requis.
- `name`: string.
- `position`: number.
- `config`: mixed.
- `nextStepKey`: string.
- `trueStepKey`: string. Utilise pour les conditions.
- `falseStepKey`: string. Utilise pour les conditions.
- `enabled`: boolean, default `true`.
- timestamps.

Index:
- `{ automation: 1, key: 1 }` unique.
- `{ company: 1, automation: 1, position: 1 }`

### automation_conditions

Optionnel mais utile pour rechercher/reutiliser les conditions en dehors du JSON de step. Une condition peut aussi etre embarquee dans `automation_steps.config` pour les cas simples.

Champs:
- `automation`: ObjectId ref `Automation`, requis, index.
- `step`: ObjectId ref `AutomationStep`, index.
- `company`: ObjectId ref `Company`, requis, index.
- `field`: string, ex: `feedback.rating`, `contact.whatsapp`, `contact.tags`, `form.id`.
- `operator`: enum `exists | not_exists | equals | not_equals | contains | not_contains | in | not_in | < | <= | > | >=`.
- `value`: mixed.
- `logicalGroup`: string, default `root`.
- `join`: enum `and | or`, default `and`.
- timestamps.

### automation_executions

Une execution complete d'une automation pour un contexte donne.

Champs:
- `automation`: ObjectId ref `Automation`, requis, index.
- `company`: ObjectId ref `Company`, requis, index.
- `trigger`: ObjectId ref `AutomationTrigger`.
- `status`: enum `queued | running | waiting | completed | failed | cancelled`, default `queued`, index.
- `currentStepKey`: string.
- `context`: mixed. Snapshot normalise de l'evenement: `company_id`, `feedback_id`, `form_id`, `contact_id`, `list_id`, `segment_id`, `rating`, `submitted_at`, `contact`, `feedback`, `custom_fields`.
- `dedupeKey`: string, index. Ex: `automationId:contactId:feedbackId`.
- `startedAt`: Date.
- `completedAt`: Date.
- `failedAt`: Date.
- `lastError`: object `{ message, code, stack, details }`.
- timestamps.

Index:
- `{ company: 1, status: 1, createdAt: -1 }`
- `{ automation: 1, status: 1 }`
- `{ dedupeKey: 1 }`, sparse unique selon `entryPolicy`.

### automation_execution_logs

Journal append-only de chaque decision, delai, action, erreur.

Champs:
- `execution`: ObjectId ref `AutomationExecution`, requis, index.
- `automation`: ObjectId ref `Automation`, requis, index.
- `company`: ObjectId ref `Company`, requis, index.
- `stepKey`: string.
- `level`: enum `debug | info | warning | error`, default `info`.
- `event`: enum `trigger_received | execution_started | step_started | condition_evaluated | delay_scheduled | action_queued | action_completed | step_failed | execution_completed | execution_failed`.
- `message`: string.
- `data`: mixed.
- `error`: object.
- timestamps.

Index:
- `{ execution: 1, createdAt: 1 }`
- `{ company: 1, level: 1, createdAt: -1 }`

### company_whatsapp_configs

Configuration WhatsApp propre a chaque entreprise. C'est le coeur de la migration hors Twilio: chaque entreprise envoie depuis son propre `phone_number_id`, tandis que la plateforme applique un quota interne de credits SaaS.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `provider`: enum `whatsapp_cloud_api`, default `whatsapp_cloud_api`.
- `wabaId`: string, requis.
- `phoneNumberId`: string, requis, index.
- `businessAccountId`: string.
- `accessTokenEncrypted`: object `{ ciphertext, iv, tag, keyVersion }`, requis.
- `webhookVerifyTokenEncrypted`: object.
- `webhookSecretEncrypted`: object. Correspond a l'app secret/signature secret si configure.
- `displayPhoneNumber`: string.
- `status`: enum `pending | active | disabled | error`, default `pending`, index.
- `lastVerifiedAt`: Date.
- `lastError`: string.
- timestamps.

Index:
- `{ company: 1, status: 1 }`
- `{ phoneNumberId: 1 }` unique.
- `{ company: 1, provider: 1 }`

### message_templates

Templates WhatsApp synchronises ou crees depuis la plateforme.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `whatsappConfig`: ObjectId ref `CompanyWhatsappConfig`, index.
- `provider`: enum `whatsapp_cloud_api`, default `whatsapp_cloud_api`.
- `providerTemplateId`: string.
- `name`: string, requis.
- `language`: string, requis, ex: `fr`, `fr_FR`, `en_US`.
- `category`: enum `marketing | utility | authentication | service`.
- `status`: enum `draft | submitted | approved | rejected | paused | disabled`, default `draft`, index.
- `components`: mixed. Header/body/footer/buttons au format Meta.
- `variables`: array `{ key, example, sourcePath }`.
- `estimatedCreditCost`: number, default `1`.
- `costRules`: mixed. Details du calcul par canal, categorie, langue, pieces jointes, nombre de variables ou politique interne.
- `lastCostCalculatedAt`: Date.
- `rejectionReason`: string.
- `lastSyncedAt`: Date.
- timestamps.

Index:
- `{ company: 1, name: 1, language: 1 }` unique.
- `{ company: 1, status: 1 }`

### message_template_cost_estimates

Historique des estimations de consommation pendant la creation d'un template.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `template`: ObjectId ref `MessageTemplate`, index.
- `channel`: enum `whatsapp | email | sms`.
- `provider`: enum `whatsapp_cloud_api | smtp | internal`.
- `category`: string. Ex: `utility`, `marketing`, `authentication`.
- `language`: string.
- `components`: mixed.
- `variablesCount`: number.
- `hasMediaHeader`: boolean.
- `estimatedCreditCost`: number, requis.
- `explanation`: string.
- `calculatedBy`: enum `system | provider_sync`, default `system`.
- timestamps.

Note produit:
- L'interface doit afficher le cout estime avant sauvegarde/publication du template.
- Pour le lancement, la facturation plateforme reste volontairement simple: 1 message WhatsApp envoye = 1 credit SaaS. Le cout Meta reel reste lie au compte WhatsApp Business connecte par l'entreprise, mais l'application controle son propre quota d'orchestration avec `estimatedCreditCost`.

### company_message_usage

Compteurs internes par entreprise.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `period`: string, ex: `2026-05`.
- `channel`: enum `whatsapp | email | sms`.
- `sentCount`: number, default `0`.
- `failedCount`: number, default `0`.
- `deliveredCount`: number, default `0`.
- `readCount`: number, default `0`.
- `estimatedCreditConsumed`: number, default `0`.
- timestamps.

Index:
- `{ company: 1, period: 1, channel: 1 }` unique.

### contact_messages

Timeline conversationnelle unifiee pour l'inbox, qu'un message soit sortant automation ou entrant webhook.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `contact`: ObjectId ref `Contact`, index.
- `conversation`: ObjectId ref `InboxConversation`, index.
- `automationExecution`: ObjectId ref `AutomationExecution`, index.
- `automationStepKey`: string.
- `channel`: enum `whatsapp | email | internal`, requis.
- `direction`: enum `inbound | outbound`, requis.
- `status`: enum `pending | sent | delivered | read | failed | received`, default `pending`, index.
- `to`: string.
- `from`: string.
- `body`: string.
- `template`: ObjectId ref `MessageTemplate`.
- `templatePayload`: mixed.
- `providerMessageId`: string, index. Pour WhatsApp: `wamid...`.
- `providerPayload`: mixed.
- `sentAt`: Date.
- `deliveredAt`: Date.
- `readAt`: Date.
- `failedAt`: Date.
- `error`: object.
- timestamps.

Index:
- `{ company: 1, contact: 1, createdAt: -1 }`
- `{ company: 1, conversation: 1, createdAt: 1 }`
- `{ providerMessageId: 1 }`, sparse.

### whatsapp_message_logs

Journal technique par tentative d'envoi et par statut webhook.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `whatsappConfig`: ObjectId ref `CompanyWhatsappConfig`, requis, index.
- `contactMessage`: ObjectId ref `ContactMessage`, index.
- `contact`: ObjectId ref `Contact`, index.
- `direction`: enum `outbound | inbound`.
- `type`: enum `template | text | image | document | audio | video | interactive | status`.
- `status`: enum `pending | accepted | sent | delivered | read | failed | received`, index.
- `providerMessageId`: string, index.
- `requestPayload`: mixed.
- `responsePayload`: mixed.
- `webhookPayload`: mixed.
- `errorCode`: string.
- `errorMessage`: string.
- `occurredAt`: Date.
- timestamps.

Index:
- `{ company: 1, status: 1, createdAt: -1 }`
- `{ providerMessageId: 1, status: 1 }`

### inbound_messages

Projection specialisee des messages entrants WhatsApp. Elle facilite le traitement webhook et l'association contact/inbox.

Champs:
- `company`: ObjectId ref `Company`, requis, index.
- `whatsappConfig`: ObjectId ref `CompanyWhatsappConfig`, requis, index.
- `contact`: ObjectId ref `Contact`, index.
- `contactMessage`: ObjectId ref `ContactMessage`, index.
- `providerMessageId`: string, requis, unique.
- `from`: string, requis.
- `toPhoneNumberId`: string, requis, index.
- `profileName`: string.
- `messageType`: string.
- `text`: string.
- `payload`: mixed.
- `receivedAt`: Date.
- `processedAt`: Date.
- timestamps.

### webhook_events

Stockage brut et idempotent des webhooks WhatsApp.

Champs:
- `company`: ObjectId ref `Company`, index.
- `whatsappConfig`: ObjectId ref `CompanyWhatsappConfig`, index.
- `provider`: enum `whatsapp_cloud_api`.
- `eventType`: enum `verification | message | status | template_status | unknown`.
- `externalEventId`: string. Peut etre `wamid + status + timestamp`.
- `phoneNumberId`: string, index.
- `signatureValid`: boolean.
- `payload`: mixed, requis.
- `processingStatus`: enum `received | processing | processed | failed`, default `received`, index.
- `error`: object.
- `receivedAt`: Date, default now.
- `processedAt`: Date.
- timestamps.

Index:
- `{ provider: 1, externalEventId: 1 }`, sparse unique.
- `{ phoneNumberId: 1, receivedAt: -1 }`
- `{ processingStatus: 1, receivedAt: 1 }`

### Inbox minimale recommandee

La demande cite `contact_messages`, `inbound_messages` et `webhook_events`, mais pour une inbox exploitable il faut aussi une conversation ou un ticket.

Collections recommandees:
- `inbox_conversations`: `company`, `contact`, `channel`, `status`, `assignee`, `lastMessageAt`, `lastMessagePreview`, `unreadCount`, timestamps.
- `tickets`: `company`, `conversation`, `contact`, `source`, `status`, `priority`, `subject`, `description`, `assignee`, timestamps.
- `internal_alerts`: `company`, `type`, `title`, `message`, `severity`, `targetUser`, `readAt`, `metadata`, timestamps.

## 2. Relations avec les tables existantes

Relations directes:
- `Company` 1-N `Automation`.
- `Company` 1-N `CompanyWhatsappConfig`.
- `Company` 1-N `MessageTemplate`.
- `Company` 1-N `ContactMessage`, `InboundMessage`, `WebhookEvent`.
- `Company` 1-N `ContactFolder`.
- `Company` 1-N `ContactList`.
- `Company` 1-N `Contact`.
- `Company` 1-N `Segment`.
- `ContactFolder` 1-N `ContactList`.
- `ContactList` 1-N `ContactListAttribute`.
- `Contact` N-N `ContactList` via `ContactListMembership`.
- `Contact` N-N `Segment` via `SegmentMembership` cache.
- `Automation` 1-N `AutomationTrigger`.
- `Automation` 1-N `AutomationStep`.
- `Automation` 1-N `AutomationExecution`.
- `AutomationExecution` 1-N `AutomationExecutionLog`.
- `Review` existant devient la source du trigger `feedback_submitted`.
- `CompanyQrCode` existant peut alimenter `form_id` ou `qr_code_id` dans le contexte.
- `User` existant est utilise pour `createdBy`, `updatedBy`, notifications manager, assignations inbox.

Relations attendues avec les modules deja mentionnes dans le SaaS:
- `Contact` 1-N `ContactMessage`, N-N `List`, N-N `Segment`, tags.
- `List` peut declencher `contact_added_to_list`.
- `Segment` peut declencher `contact_entered_segment`.
- Les champs custom du contact et les reponses custom du feedback sont exposes dans le contexte d'automation.

Le backend actuel ne contient pas encore de model `Contact`, `List`, `Folder` ou `Segment`; ils doivent etre generes comme socle du module automation. Le module QR Feedback reste intact: on ajoute seulement un branchement apres creation d'un feedback pour creer/mettre a jour le contact, l'ajouter a la liste mappee et declencher les automations.

## 3. Architecture backend

Services:
- `ContactFolderService`: cree le dossier par defaut et gere les dossiers.
- `ContactListService`: cree la liste par defaut, gere les listes, attributs et compteurs.
- `ContactService`: dedoublonnage, creation, mise a jour, tags, historique contact.
- `QrFormListMappingService`: mappe un QR form vers une liste et cree les attributs manquants.
- `SegmentService`: CRUD segments, evaluation et recalcul.
- `MessageUsageService`: estime et enregistre la consommation interne des templates/messages.
- `AutomationService`: CRUD automation, publication, validation du graphe, duplication/versioning.
- `AutomationTriggerDispatcher`: recoit un evenement metier, trouve les automations actives compatibles, cree les executions.
- `AutomationExecutionService`: cree, reprend, termine ou annule une execution; gere le contexte et le dedoublonnage.
- `AutomationStepExecutor`: execute le step courant et decide du prochain step.
- `ConditionEvaluator`: evalue les conditions sur un contexte avec des operateurs stricts.
- `ActionExecutor`: route les actions vers les services specialises.
- `WhatsAppConfigService`: CRUD config entreprise, chiffrement tokens, verification minimale.
- `WhatsAppService`: client Meta Cloud API, envoi template/text, normalisation erreurs, mapping statuts.
- `MessageTemplateService`: CRUD templates, validation variables, sync Meta.
- `InboxService`: cree/retrouve conversation, ajoute messages, cree tickets/alertes.

Jobs:
- `RecalculateListContactCountJob`: recalcule `contactCount`.
- `RecalculateSegmentJob`: met a jour le cache `segment_memberships`.
- `RunAutomationJob`: demarre une execution a partir d'un trigger.
- `ExecuteAutomationStepJob`: execute un step; supporte `runAt` pour les delays.
- `SendWhatsappMessageJob`: envoie le message via la config active de l'entreprise.
- `ProcessWhatsappWebhookJob`: traite les payloads recus, met a jour logs/messages/inbox.

Implementation progressive sans dependance lourde:
- Phase 1: job runner MongoDB simple avec collection `automation_jobs` ou execution immediate + `setTimeout` pour dev.
- Phase 2: ajouter BullMQ/Redis pour retries, delays fiables, concurrence et reprise apres restart.

## 4. Flow complet d'execution d'une automation

1. Le module QR Feedback cree un `Review`.
2. `QrFormListMappingService` cherche si le QR form est associe a une liste.
3. Si oui, `ContactService` cree ou met a jour le contact avec les champs mappes.
4. `ContactListService` ajoute le contact a la liste mappee.
5. Les activites `feedback_submitted`, `contact_created/contact_updated` et `added_to_list` sont ecrites dans `contact_activities`.
6. Le backend emet les evenements internes correspondants vers `AutomationTriggerDispatcher`.
7. Le dispatcher construit un contexte normalise:
   - `company_id`
   - `feedback_id`
   - `form_id` ou `qr_code_id`
   - `contact_id`
   - `list_id`
   - `segment_id`
   - `rating`
   - `submitted_at`
   - `contact`
   - `feedback`
   - `custom_fields`
8. Le dispatcher cherche les `automation_triggers` actifs pour `company + type`.
9. Pour chaque trigger compatible, il applique les filtres rapides du trigger: formulaire, note, liste, segment.
10. Il cree une `automation_execution` avec snapshot du contexte et `status = queued`.
11. Il ecrit un log `trigger_received`.
12. Il enfile `RunAutomationJob`.
13. `RunAutomationJob` passe l'execution a `running`, choisit le premier step actif.
14. `ExecuteAutomationStepJob` execute le step:
    - `condition`: `ConditionEvaluator` retourne true/false, log la decision, choisit `trueStepKey` ou `falseStepKey`.
    - `delay`: calcule `runAt`, passe l'execution a `waiting`, programme un prochain job.
    - `action`: `ActionExecutor` execute ou enfile l'action specialisee.
15. Apres chaque step, un log est cree.
16. Si aucun prochain step n'existe, l'execution passe a `completed`.
17. En cas d'erreur recuperable, le job retry et log l'erreur.
18. En cas d'erreur finale, l'execution passe a `failed` avec `lastError`.

## 5. Flow complet WhatsApp depuis le numero configure par entreprise

1. Une action `send_whatsapp_message` arrive dans `ActionExecutor`.
2. L'action resout `company_id` depuis l'execution.
3. `WhatsAppConfigService` recupere la config active:
   - `company = execution.company`
   - `provider = whatsapp_cloud_api`
   - `status = active`
4. Le service dechiffre `accessTokenEncrypted`.
5. `MessageTemplateService` recupere le template approuve de cette entreprise.
6. Les variables `{{contact.first_name}}`, `{{feedback.rating}}`, etc. sont rendues depuis le contexte.
7. `MessageUsageService` calcule la consommation interne du template et la journalise.
8. `InboxService` cree un `contact_messages` sortant en `pending`.
9. `WhatsAppService` appelle Meta Graph API avec le `phoneNumberId` de cette entreprise:
   - `POST https://graph.facebook.com/{version}/{phone_number_id}/messages`
   - `Authorization: Bearer <access_token_entreprise>`
10. La reponse Meta fournit un `providerMessageId` de type `wamid...`.
11. Le `contact_messages` passe a `sent` ou `pending/accepted` selon la reponse.
12. Un `whatsapp_message_logs` est cree avec request/response.
13. `company_message_usage` est incremente selon la politique interne.
14. Meta appelle le webhook global de la plateforme.
15. `ProcessWhatsappWebhookJob` identifie l'entreprise par `metadata.phone_number_id`.
16. Si webhook status:
    - trouve `contact_messages.providerMessageId`
    - met a jour `sent`, `delivered`, `read` ou `failed`
    - ajoute une entree `whatsapp_message_logs`
17. Si webhook message entrant:
    - trouve ou cree le contact via le numero `from`
    - trouve ou cree la conversation inbox
    - cree `inbound_messages`
    - cree `contact_messages` direction `inbound`
    - incremente `unreadCount`

Sources techniques verifiees le 2026-05-21:
- Meta Cloud API route les envois par `phone_number_id` et utilise un endpoint `/{phone_number_id}/messages`.
- Les webhooks contiennent le `phone_number_id`, ce qui permet de router un webhook global vers la bonne entreprise.
- Les statuts de message doivent etre suivis via webhooks asynchrones: `sent`, `delivered`, `read`, `failed`.

## 6. Endpoints API a generer progressivement

CRM Contacts/Listes/Segments:
- `GET /api/contact-folders`
- `POST /api/contact-folders`
- `PATCH /api/contact-folders/:id`
- `DELETE /api/contact-folders/:id`
- `GET /api/contact-lists`
- `POST /api/contact-lists`
- `GET /api/contact-lists/:id`
- `PATCH /api/contact-lists/:id`
- `DELETE /api/contact-lists/:id`
- `POST /api/contact-lists/:id/recalculate`
- `GET /api/contact-lists/:id/attributes`
- `POST /api/contact-lists/:id/attributes`
- `GET /api/contact-lists/:id/contacts`
- `POST /api/contact-lists/:id/contacts`
- `GET /api/contacts`
- `POST /api/contacts`
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`
- `GET /api/contacts/:id/activities`
- `GET /api/contacts/:id/messages`
- `GET /api/segments`
- `POST /api/segments`
- `GET /api/segments/:id`
- `PATCH /api/segments/:id`
- `POST /api/segments/:id/recalculate`

QR form mapping:
- `GET /api/qrcodes/:id/list-mapping`
- `PUT /api/qrcodes/:id/list-mapping`

Automations:
- `GET /api/automations`
- `POST /api/automations`
- `GET /api/automations/:id`
- `PATCH /api/automations/:id`
- `POST /api/automations/:id/publish`
- `POST /api/automations/:id/pause`
- `DELETE /api/automations/:id`
- `GET /api/automations/:id/executions`
- `GET /api/automation-executions/:id/logs`

WhatsApp config:
- `GET /api/whatsapp/config`
- `PUT /api/whatsapp/config`
- `POST /api/whatsapp/config/test`
- `POST /api/whatsapp/config/disable`

Templates:
- `GET /api/message-templates`
- `POST /api/message-templates`
- `POST /api/message-templates/estimate-cost`
- `GET /api/message-templates/:id`
- `PATCH /api/message-templates/:id`
- `POST /api/message-templates/:id/sync`

Inbox:
- `GET /api/inbox/conversations`
- `GET /api/inbox/conversations/:id/messages`
- `POST /api/inbox/conversations/:id/messages`
- `POST /api/inbox/conversations/:id/tickets`

Webhooks:
- `GET /api/webhooks/whatsapp`
- `POST /api/webhooks/whatsapp`

## 7. Ordre de generation recommande

1. Models Mongoose du socle CRM: folders, lists, attributes, contacts, memberships, tags, mappings QR form, segments, activities.
2. Services CRM: creation du dossier/liste par defaut, contact upsert, mapping QR form -> liste, recalcul compteurs.
3. Models automation: automation, triggers, steps, conditions, executions, logs.
4. Models WhatsApp/inbox: config, templates, cost estimates, messages, logs, inbound, webhooks, usage.
5. Enums/types partages pour triggers, steps, actions, statuts, conditions.
6. Services purs: condition evaluator, context resolver, template variable renderer, template cost estimator.
7. Services metier: automation dispatcher/execution/step/action.
8. WhatsApp Cloud API service et config service.
9. Webhook WhatsApp controller + processor.
10. Endpoints CRUD CRM puis automation/config/templates/inbox.
11. Branchement minimal dans `review.service.ts` apres creation d'un feedback: upsert contact, add to mapped list, dispatch `feedback_submitted`.
12. Tests unitaires sur dedoublonnage contact, mapping QR form, segments, conditions, delays, rendu variables, estimation cout template et idempotence webhook.
