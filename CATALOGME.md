# Building a Weebi demo catalog

One activity, one SQLite `.db`. Load it in Studio (**Charger .db**) and import it in the Weebi app. There is no shared catalog database.

`data/` holds the raw photos. It is gitignored. Packs land in `catalogs/`.

## Rules

- **No photo, no article.** A file that is not a usable product shot is listed as skipped, not invented.
- **Categories are the structure.** The till browses by rayon (LAIT, PLATS, PAINS), not by brand. Brand is only a word in the name.
- **Prices are conservative FCFA**, round, cost `0`. They are placeholders, not a shop's price list.
- **Different sizes or strengths stay separate articles.** Nido 400 g and Nido 900 g are two articles in LAIT. Doliprane 500 mg and Doliprane 1000 mg would be the same: two articles in the same rayon.
- **A unit and its pack share a parent.** Babybel x1 / x12 / x28, or a glass and its bottle (Champagne verre / Champagne bouteille), are one **Article parent** plus **sous-articles**. `units_in_one_piece` is the pack count (1 for a glass or a single box, 12 for a box of 12). A pack with no matching unit stays a single article whose name carries the count.
- **One photo per sellable line.** Prefer the file that already sits in a category folder, then jpeg over png. Drop copies (`(2)`, `copie`, `Croissant1`).
- **Retail only.** `kind` is `retail`, `stock_unit` is `unit`. Studio's soft cap is about 500 articles.

Photos are stored as JPEG BLOBs, longest edge 800 px, quality 0.7. A standalone article uses photo id `0`. A parent uses id `0` for the tile (the unit shot) and id `1..n` for each sous-article.

Schema: [`schema/v1.sql`](schema/v1.sql). Writer: [`js/catalog/export_weebi.js`](js/catalog/export_weebi.js).

## Which builder to copy

| Raw photos | Do this | Example |
|---|---|---|
| Few dozen or a few hundred, names already readable | Curated list | Restaurant, boulangerie, maraîcher — [`scripts/activity_catalogs.mjs`](scripts/activity_catalogs.mjs) |
| Large messy dump (brand folders, shoot codes, typos, twins) | Parser + dedupe | Boutique alimentaire — [`scripts/dakar_catalog.mjs`](scripts/dakar_catalog.mjs) |

Pharmacy photos with readable filenames should use the curated list. Switch to a parser only if the folder is a brand dump you cannot name by hand.

## Add a catalog (pharmacy)

1. Put photos under `data/`, one folder per source (`data/PHARMACIE/…`). One product per file. Skip PDFs and barcode-only names.
2. Decide the rayons the till will show, in display order. Keep titles short and stable (`MEDICAMENTS`, `PARAPHARMACIE`, `BEBE`, …). Do not file by laboratory.
3. Add a block to `ACTIVITY_CATALOGS` in [`scripts/activity_catalogs.mjs`](scripts/activity_catalogs.mjs):

```js
{
  id: 'pharmacie',
  dbFile: 'pharmacie.db',
  skipped: [
    { file: 'PHARMACIE/doliprane-copie.png', reason: 'doublon' },
  ],
  categories: [
    {
      title: 'MEDICAMENTS',
      items: [
        // different strengths: two articles, not a parent
        { name: 'Doliprane 1000 mg', price: 800, file: 'PHARMACIE/doliprane 1000.png' },
      ],
      parents: [
        // same box sold as 1 and as a pack of 10
        {
          title: 'Doliprane 500 mg',
          articles: [
            { name: 'Doliprane 500 mg', price: 500, lot: 1, file: 'PHARMACIE/doliprane.png' },
            { name: 'Doliprane 500 mg x10', price: 4500, lot: 10, file: 'PHARMACIE/doliprane x10.png' },
          ],
        },
      ],
    },
  ],
}
```

`items` are standalone articles. `parents` are only for the same product sold as a unit and as a pack. A parent title must not also appear as an `items` name. One category object can hold both.

4. Extend the folder map in [`test/activity_catalogs.test.js`](test/activity_catalogs.test.js) so every file on disk is either referenced or skipped. The test fails if a photo is forgotten or listed twice.
5. Build and open the pack:

```bash
npm test
npm run build:activites
npm start
```

In Studio, load `catalogs/pharmacie.db`. Check the first rayon, one flat article, and one parent if you defined one. A `.review.json` is written beside the `.db`.

## Naming and prices

Names are what the cashier reads. French, accents, the size in the name when it distinguishes the article (`Tomate` is per kilo in LEGUMES; `Doliprane 500 mg` carries the strength).

Fix obvious filename mistakes while naming (`thieboudieun` → Thieboudienne, `Pain de maos` → Pain de maïs, `micuit` → Moelleux chocolat). If the pack shows no readable size, drop the file and record why in `skipped`.

Price bands used so far, in FCFA, deliberately low:

- Grocery weight: under 30 g → 100; to 100 g → 200; to 250 g → 500; to 500 g → 1 000; to 1 kg → 1 500; to 2,5 kg → 3 000; to 5 kg → 6 000; to 10 kg → 10 000; above → 20 000. Drinks: 33 cl → 300, 50 cl → 500, 1 L → 800, 1,5 L → 1 000, 2 L → 1 200. A multipack is unit price × count × 0,9, rounded to 100. Portion packs (Babybel x12) are priced once, not multiplied twice.
- Restaurant: sides 500–1 000, starters 1 500–3 000, mains 2 500–4 500, desserts 1 000–2 000. Soft drinks 300–1 000, beer 600–1 000, wine glass 2 000 / bottle 8 000, champagne glass 4 000 / bottle 20 000.
- Bakery: bread 200–500, viennoiserie 300–500, sandwiches 700–1 500.
- Produce: common vegetables 300–800 per kg, fruit 400–1 500, herbs 200 a bunch, baskets 2 500–5 000.

For a pharmacy, pick one round price per form (sachet, box, syrup, tube) and keep it in the catalog file so it can be edited without touching the builder.

## Packs already built

| Pack | Command | Output |
|---|---|---|
| Boutique alimentaire, Dakar | `npm run build:dakar` | `catalogs/boutique_alimentaire_dakar.db` |
| Restaurant et boissons, boulangerie, maraîcher | `npm run build:activites` | `catalogs/restaurant_boissons.db`, `catalogs/boulangerie.db`, `catalogs/maraicher_primeur.db` |

Sources for the grocery pack: `data/BOUTIQUE_ALIMENTAIRE_CATEGORIES`, `data/BOUTIQUE_ALIMENTAIRE_VRAC`, `data/_MARQUES`. The eight folder names are the rayons and stay spelled as on disk, including `KETCHUP SAUVE TOMATE`. Text lists in `data/` do not add articles.

Sources for the activity packs: `data/RESTAURANT`, `data/BOISSONS`, `data/BOULANGERIE`, `data/MARAICHER_PRIMEUR`. Restaurant and drinks are one pack. A drink that exists in both folders is kept from `BOISSONS` only.
