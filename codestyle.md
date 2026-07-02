# Regles de style de code - Opinbase

Statut: document de reference pour le backend `back/` et le frontend `front/`.
Ces conventions priment pour les nouvelles features et les refactors touches par une tache.

Ce document definit le style a suivre pour le reste du projet. L'objectif est un code lisible, maintenable, deployable et facile a faire evoluer.

## Langage et format

- TypeScript strict.
- ESM uniquement.
- Imports relatifs avec extension `.js` dans le backend NodeNext.
- ASCII par defaut dans les fichiers source.
- Noms explicites plutot que raccourcis.
- Fonctions courtes quand c'est possible.
- Pas de commentaires evidents. Commenter seulement les blocs non triviaux.

## Nommage

Backend:

- Models: `PascalCase`, exemple `ContactList`.
- Fichiers models: `ContactList.ts`.
- Services: `camelCase.service.ts`, exemple `contactList.service.ts`.
- Controllers: `camelCase.controller.ts`.
- Routes: `camelCase.routes.ts`.
- Types exportes: `PascalCase`.
- Fonctions: verbe + objet, exemple `createSegment`, `recalculateSegment`.

Frontend:

- Composables: `useX.ts`.
- Views: `XView.vue`.
- Components: `PascalCase.vue`.
- Types API proches du composable qui les utilise.

## Backend controllers

Un controller doit:

- lire `req.params`, `req.query`, `req.body`, `req.company`, `req.user`
- appeler un service
- retourner une reponse JSON

Un controller ne doit pas:

- contenir une logique metier longue
- faire des agregations Mongoose complexes
- gerer des details de chiffrement ou providers externes

## Backend services

Un service doit:

- porter la logique metier
- etre testable sans HTTP
- recevoir explicitement les objets necessaires
- respecter le scope `company`
- retourner des objets utiles et previsibles

Preferer:

```ts
export async function createSegment(company, payload) {}
```

Eviter:

```ts
export async function createSegment(req) {}
```

## Mongoose

Regles:

- Declarer les enums en `as const` quand ils sont partages.
- Exporter `InferSchemaType` + `_id`.
- Definir les index dans le fichier model.
- Utiliser `lean()` pour les lectures qui ne modifient pas le document.
- Utiliser `HydratedDocument<T>` quand un service modifie et sauvegarde.
- Ne pas stocker de donnees derivees sauf besoin de performance ou cache explicite.

Soft delete:

- Utiliser `archivedAt` pour les objets metier.
- Les requetes utilisateur doivent filtrer `archivedAt: { $exists: false }`.

## Validation

- Les validators Express restent dans `src/validators` ou proches de la route si tres local.
- Les validators doivent rejeter les payloads invalides avant le controller.
- Les services doivent quand meme verifier les invariants critiques.

## Erreurs

- Utiliser `HttpError` pour les erreurs metier.
- Messages d'erreur clairs et actionnables.
- Ne pas exposer les erreurs internes, secrets ou payloads sensibles.

## Normalisation

Les donnees utilisees pour matcher doivent etre normalisees avant stockage:

- `whatsappNormalized`
- `phoneNormalized`
- `emailNormalized`

Ne jamais comparer les numeros bruts pour dedoublonner.

## WhatsApp

Regles:

- Provider unique: `whatsapp_cloud_api`.
- Utiliser `fetch` vers Graph API dans le service provider dedie.
- Nommer les identifiants provider WhatsApp `whatsappMessageId`.
- Les messages doivent utiliser la config active de l'entreprise.
- Toute reponse provider importante doit etre loggee dans un model technique.
- Les activites utilisateur/contact doivent rester lisibles et non brutes.

## Segments

Regles:

- Les templates sont declares clairement dans `segment.service.ts` ou un fichier dedie si la liste grossit.
- Une condition reste simple: `field`, `operator`, `value`.
- Les segments dynamiques peuvent etre recalcules.
- Les segments statiques sont controles par `contactIds`.
- Ne pas melanger logique UI et logique d'evaluation dans le frontend.

## Frontend Vue

Regles:

- Garder les pages lisibles.
- Extraire les appels API dans des composables.
- Eviter les composants enormes.
- Utiliser des types explicites pour les payloads API.
- Ne pas dupliquer la logique de validation metier critique du backend; le front aide l'utilisateur, le backend decide.

UI:

- Interfaces denses et pratiques pour les outils CRM/SaaS.
- Boutons avec icones quand pertinent.
- Pas de textes explicatifs longs dans l'app si l'action est evidente.
- Etats loading, empty, error pour les vues importantes.
- Les listes/tableaux doivent supporter recherche, pagination ou filtres des que le volume peut grandir.

## API client frontend

- Tous les appels passent par `api()`.
- Les composables exposent des fonctions courtes.
- Les composants ne construisent pas des URLs API complexes si un composable existe.

## Imports

- Grouper les imports par origine naturellement.
- Supprimer les imports inutilises.
- Utiliser `type` pour les imports de types:

```ts
import type { HydratedDocument } from 'mongoose';
```

## Donnees sensibles

Interdit:

- afficher un token complet
- logger un access token
- renvoyer un secret non masque
- stocker un token provider en clair

Obligatoire:

- chiffrer avant stockage
- masquer dans les serializers

## Verification avant finalisation

Selon les fichiers touches:

- Backend: `npm run type-check`
- Frontend: `npm run type-check`
- Si dependances changees: verifier `package-lock.json`
- Si suppression/renommage: rechercher les anciennes references avec `rg`

## Refactoring

- Refactoriser seulement ce qui sert la tache en cours.
- Ne pas melanger refactor massif et feature metier sans raison.
- Preserver les changements utilisateur.
- Garder les migrations de structure progressives.

