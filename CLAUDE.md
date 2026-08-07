# ⛔ STOP — dépôt GÉNÉRÉ, ne rien modifier ici

**Ce dépôt est une sortie de build, pas du code source.** Il est produit par `node build.js`
depuis un dépôt source séparé (privé), puis publié automatiquement par une GitHub Action.

## Si tu es un agent qui vient d'ouvrir ce dépôt : tu n'es pas au bon endroit.

`index.html`, `app.js`, `sw.js`, `manifest.json` et les icônes sont **tous régénérés ou recopiés
à chaque déploiement**. Une modification faite ici :

1. **sera effacée sans trace** au prochain déploiement ;
2. **n'a traversé aucun contrôle** — le smoke-test qui protège la prod (13 contrôles, dont le rendu
   réel de la page dans Chrome) vit dans le dépôt source et ne se déclenche pas sur un push ici.

Le second point est le plus grave : éditer ici, c'est publier directement en production **en
contournant le seul garde-fou**. Un service worker cassé poussé de cette façon se met en cache chez
les utilisateurs.

## Ce qu'il faut faire à la place

**Arrête-toi et dis-le à Vincent** : la session doit être rouverte sur le dépôt **source**
(`vincenttnl/spotane`, privé), où se trouvent `NOMADE.md`, `CLAUDE.md`, les fiches d'agents et le
workflow de déploiement.

Signe qui ne trompe pas : dans le dépôt source, `index.html` contient du **JSX dans
`<script type="text/babel">`**. Ici, il charge un `app.js` déjà transpilé. Si tu vois `app.js?v=`,
tu es dans le dépôt généré.

Une fois la correction faite dans la source, le déploiement vers ici est **automatique** — personne
n'a jamais besoin de pousser à la main dans ce dépôt.

## Historique

Créé le 07/08/2026, après qu'une session lancée sur ce dépôt par erreur y a écrit une fonctionnalité
qui aurait disparu au déploiement suivant.
