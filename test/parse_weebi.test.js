import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWeebiArticlesJson } from '../js/catalog/parse_weebi_json.js';
import { parseCatalogCsv } from '../js/catalog/parse_csv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, 'fixtures');

describe('parseWeebiArticlesJson', () => {
  it('loads the Weebi app export fixture', () => {
    const raw = readFileSync(join(fixtures, 'weebi_articles.json'), 'utf8');
    const catalog = parseWeebiArticlesJson(raw);
    assert.equal(catalog.calibres.length, 3);
    const license = catalog.calibres.find((c) => c.title === 'license weebi');
    assert.ok(license);
    assert.equal(license.tempId, 5);
    assert.equal(license.articles[0].price, 29);
    assert.equal(license.articles[0].unitsInOnePiece, 1);
    assert.equal(catalog.warnings.length, 0);
  });

  it('skips baskets with a warning', () => {
    const raw = JSON.stringify([
      {
        id: 1,
        title: 'Pack',
        kind: 'basket',
        articles: [{ id: 1, designation: 'Pack', price: 10, cost: 0 }],
      },
      {
        id: 2,
        title: 'Solo',
        kind: 'retail',
        articles: [
          {
            id: 1,
            designation: 'Solo',
            price: 5,
            cost: 1,
            barcodeEAN: 'X',
            unitsInOnePiece: 2,
          },
        ],
      },
    ]);
    const catalog = parseWeebiArticlesJson(raw);
    assert.equal(catalog.calibres.length, 1);
    assert.equal(catalog.calibres[0].title, 'Solo');
    assert.ok(catalog.warnings.some((w) => w.includes('basket')));
  });

  it('supports multi-variant retail calibres', () => {
    const raw = JSON.stringify([
      {
        id: 10,
        title: 'Coca-Cola',
        kind: 'retail',
        articles: [
          {
            id: 1,
            designation: '33cl',
            price: 500,
            cost: 300,
            barcodeEAN: 'A',
            unitsInOnePiece: 1,
          },
          {
            id: 2,
            designation: '1.5L',
            price: 1200,
            cost: 800,
            barcodeEAN: 'B',
            unitsInOnePiece: 1,
          },
        ],
      },
    ]);
    const catalog = parseWeebiArticlesJson(raw);
    assert.equal(catalog.calibres[0].articles.length, 2);
  });
});

describe('Weebi CSV adapter', () => {
  it('parses Weebi export CSV with a lossy warning', () => {
    const raw = readFileSync(join(fixtures, 'weebi_articles.csv'), 'utf8');
    const catalog = parseCatalogCsv(raw);
    assert.equal(catalog.calibres.length, 3);
    assert.ok(
      catalog.warnings.some((w) => w.toLowerCase().includes('code-barres')),
    );
    const git = catalog.calibres.find((c) => c.title === 'test git');
    assert.equal(git.articles[0].price, 20);
    assert.equal(git.articles[0].unitsInOnePiece, 1);
  });
});
