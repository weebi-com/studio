# Studio Weebi

Gestionnaire de références articles Weebi (éditeur libre, sans authentification).

## Objectif

- Charger un pack **`.db`**, un export Weebi (**JSON articles**) ou un CSV Studio
- Éditer en tableur (jspreadsheet) avec types **Article / Article parent / Sous-article**
- Joindre des **photos** (redimensionnées JPEG, BLOB dans le pack)
- Exporter un fichier **SQLite `.db`** importable dans l’app Weebi

## Workflow recommandé

1. **Charger** un `.db` existant, un JSON Weebi (`*_articles.json`), ou un CSV Studio
2. Pour un article simple : Type **Article**, renseigner libellé / prix / lots
3. Pour des déclinaisons (ex. Coca 33cl + Coca x6) :
   - créer une ligne **Article parent** (nom du calibre, sans prix)
   - sur une autre ligne, passer Type à **Sous-article** → dialogue (parent + **Vendu par lots de**)
4. Optionnel : cliquer **Photo** pour joindre une image
5. **Exporter .db** → importer le pack dans Weebi

### Colonnes

`Photo | Type | Article / Libellé | Vendu par lots de | Prix | Coût | Code-barres | Catégorie | Parent`

| Type | Rôle |
|------|------|
| **Article** | Article autonome (calibre + 1 article) |
| **Article parent** | Calibre visible, sans prix/coût |
| **Sous-article** | Article lié à un article parent (`unitsInOnePiece` = lots) |

### Sources de données

| Source | Usage |
|--------|--------|
| **`.db`** | Pack SQLite Studio ↔ Weebi (réouverture complète) |
| **JSON Weebi** (`*_articles.json`) | Catalogue existant (calibres + articles) |
| **CSV Studio** (`type,name,lot,…`) | Création greenfield / Excel |
| **CSV Studio historique** (`calibre_title,…`) | Best-effort + avertissement |
| **CSV Weebi** (`*_articles.csv`) | Best-effort (incomplet) |

## Format `.db` (SQLite)

- Extension : `.db`
- MIME : `application/x-sqlite3`
- Schéma versionné : [`schema/v1.sql`](schema/v1.sql) — `VERSION` = `1`
- Photos en BLOB JPEG (max ~800 px côté long, qualité ~0.7)

## Stack

- Site statique (GitHub Pages)
- Vanilla JS + [sql.js](https://sql.js.org/) + [jspreadsheet-ce](https://github.com/jspreadsheet/ce) (MIT)
- Français uniquement

## Développement

```bash
npm install
npm test
npm start
```

`npm start` sert le dossier courant (`npx serve .`). Ouvrir l’URL affichée (souvent http://localhost:3000).

## Limites v1

- Articles **retail** uniquement (paniers ignorés à l’import JSON / `.db`)
- `stock_unit` fixé à `unit`
- Cap soft : ~500 articles, peu de photos
- Pas d’auto-promotion d’un Article en Article parent
- Pas de chargement des exports catégories / chemins photos Weebi (hors pack `.db`)
