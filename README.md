# Fou du Roi — analyseur de parties d’échecs

Application web 100 % statique (HTML/CSS/JavaScript, sans étape de compilation) pour analyser vos parties
d’échecs avec le moteur **Stockfish 19** exécuté localement dans votre navigateur (WebAssembly, Web Worker).
Toute l’interface est en français ; thème sombre par défaut (bouton en haut à droite pour le thème clair).

## Lancer l’application

### Le plus simple : double-clic

Ouvrez le fichier **`FouDuRoi.html`** (à la racine de l’archive, ou dans `dist/`) par **double-clic**.
Il s’ouvre dans votre navigateur et contient toute l’application (moteur Stockfish compris) :
aucune installation, aucun terminal. Navigateur conseillé : Chrome, Edge ou Firefox.

### Sur iPhone (appli installable)

Une fois l’application en ligne (par exemple sur GitHub Pages) :

1. Ouvrez son adresse dans **Safari**.
2. Touchez le bouton **Partager** (carré avec une flèche vers le haut), puis **« Sur l’écran d’accueil »**.
3. L’icône « Fou du Roi » apparaît : l’appli s’ouvre en plein écran et fonctionne aussi **hors ligne**
   (sauf la synchronisation Chess.com / Lichess, qui a besoin d’Internet).

Une bannière rappelle ces étapes quand on ouvre le site dans Safari sur iPhone.
Les mises à jour du site sont récupérées automatiquement en arrière-plan (visibles à l’ouverture suivante).

### Avec un serveur local (pour développer)

Depuis le dossier du projet :

```bash
python3 -m http.server 8765
```

puis ouvrez <http://localhost:8765/>. (Ouvrir `index.html` par double-clic ne fonctionne pas :
utilisez `FouDuRoi.html` pour cela.)

Pour régénérer `dist/FouDuRoi.html` après une modification : `npm install` puis `npm run build:single`.

## Fonctionnalités

- **Importer** : coller un PGN (une ou plusieurs parties), charger un fichier `.pgn` (glisser-déposer accepté,
  plusieurs parties → liste de choix), récupérer les parties récentes d’un pseudo sur **Lichess** ou **Chess.com**,
  ou cliquer sur **« Charger un exemple »** (`samples/exemple.pgn`, 6 parties).
- **Échiquier** : navigation par boutons et au clavier (← →, ↑/Origine = début, ↓/Fin = fin, F = retourner),
  dernier coup surligné, coups cliquables, notation française (R, D, T, F, C) ou anglaise.
- **Analyse Stockfish** de toute la partie (profondeur réglable, 14 par défaut) avec barre de progression ;
  barre d’évaluation, flèche du meilleur coup et ligne principale pour la position affichée
  (une analyse rapide « en direct » est faite si la partie n’a pas encore été analysée).
- **Courbe d’évaluation** cliquable (points de couleur sur les imprécisions, erreurs et gaffes).
- **Classification des coups** selon la perte de probabilité de gain :
  Excellent (< 2 % ou meilleur coup), Bon (< 5 %), Imprécision (< 10 %), Erreur (< 20 %), Gaffe (≥ 20 %),
  avec « Le meilleur coup était … » pour les coups imparfaits.
- **Bilan par joueur** : précision (formule fondée sur la probabilité de gain, moyenne pondérée par la volatilité
  + moyenne harmonique), nombre de coups par catégorie, perte moyenne en centipions.
- **Mes statistiques** : victoires / nulles / défaites, résultats par couleur, ouvertures les plus jouées
  (en-têtes `Opening`, `ECOUrl` de Chess.com ou `ECO`) avec scores. Plusieurs pseudos possibles, séparés par des virgules.
- **Mon compte** : choisissez Chess.com et/ou Lichess et saisissez votre pseudo (aucun mot de passe : les API
  publiques n’en ont pas besoin). Au démarrage (option) et avec le bouton **« Synchroniser »**, vos parties récentes
  sont importées automatiquement : plusieurs archives mensuelles Chess.com (3 mois par défaut, réglable),
  jusqu’à 50 parties Lichess (réglable). Les parties déjà importées sont ignorées (identifiées par leur adresse
  sur le site). « Mes statistiques » utilise ce pseudo par défaut et l’échiquier est orienté de votre côté.
  Un **jeton d’accès personnel Lichess** facultatif peut être saisi pour inclure les parties privées ;
  il n’est stocké que dans votre navigateur et n’est envoyé qu’à lichess.org.
- **Persistance** : parties, analyses et réglages sont enregistrés dans le `localStorage` du navigateur
  (onglet « Bibliothèque » pour rouvrir, filtrer ou supprimer).

## Structure

```
index.html            page unique
css/style.css         styles (thèmes sombre et clair)
js/app.js             interface, navigation, analyse, statistiques, compte
js/board.js           échiquier SVG et pièces vectorielles originales
js/engine.js          dialogue UCI avec Stockfish dans un Web Worker
js/analysis.js        probabilité de gain, classification, précision, perte moyenne
js/graph.js           courbe d’évaluation (canvas)
js/pgn.js             découpage / lecture PGN (chess.js), identifiants de parties
js/importers.js       API publiques Lichess et Chess.com
js/stats.js           statistiques par joueur
js/storage.js         localStorage
samples/exemple.pgn   parties d’exemple
vendor/               chess.js (BSD-2) et Stockfish 19 lite mono-thread (GPLv3)
tests/e2e.js          test de bout en bout Playwright (API simulées)
```

## Tests

```bash
python3 -m http.server 8765 &   # dans le dossier du projet
node tests/e2e.js
```

Le test charge la page dans Chromium, colle un PGN, navigue, lance l’analyse (profondeur 8), vérifie la courbe,
les classifications, la précision, l’import de fichier, les messages d’erreur, la synchronisation du compte
(réponses Lichess / Chess.com **simulées** par interception réseau), les statistiques et la persistance, puis
enregistre `screenshot.png`.

## Mettre à jour les dépendances

```bash
npm install
npm run vendor   # recopie chess.js et Stockfish dans vendor/
```

## Licences

Stockfish.js est distribué sous licence GPLv3 (`vendor/stockfish/Copying.txt`), chess.js sous licence BSD-2
(`vendor/chess.js/LICENSE`). Les pièces, le design et le code de l’application sont originaux.
