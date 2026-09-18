import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogCsv } from '../js/catalog/parse_csv.js';

describe('parseCatalogCsv', () => {
  it('parses type-based Studio CSV with parent and sous-articles', () => {
    const csv = [
      'type,name,lot,price,cost,barcode_ean,category,parent',
      'Article parent,Coca-Cola,,,,,Boissons,',
      'Sous-article,Coca 33cl,1,500,300,5449000000996,,Coca-Cola',
      'Sous-article,Coca x6,6,2800,1700,5449000054227,,Coca-Cola',
      'Article,Sucre 1kg,1,100,80,,,',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);
    assert.equal(catalog.calibres.length, 2);
    const coca = catalog.calibres.find((c) => c.title === 'Coca-Cola');
    assert.ok(coca);
    assert.equal(coca.articles.length, 2);
    assert.equal(coca.articles[1].unitsInOnePiece, 6);
    assert.equal(catalog.categories[0].title, 'Boissons');
  });

  it('still parses legacy Produit / Sous-produit CSV labels', () => {
    const csv = [
      'type,name,lot,price,cost,barcode_ean,category,parent',
      'Produit parent,Coca-Cola,,,,,Boissons,',
      'Sous-produit,Coca 33cl,1,500,300,,,Coca-Cola',
      'Produit,Sucre 1kg,1,100,80,,,',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);
    assert.equal(catalog.calibres.length, 2);
    assert.equal(
      catalog.calibres.find((c) => c.title === 'Coca-Cola').articles.length,
      1,
    );
  });

  it('parses legacy Studio CSV with a migration warning', () => {
    const csv = [
      'calibre_title,article_id,designation,price,cost,barcode_ean,units_in_one_piece,category',
      'Coca-Cola,1,Coca-Cola 33cl,500,300,5449000000996,1,Boissons',
      'Coca-Cola,2,Coca-Cola 1.5L,1200,800,5449000054227,1,Boissons',
      'Sucre,1,Sucre 1kg,100,80,,1,',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);

    assert.equal(catalog.calibres.length, 2);
    const coca = catalog.calibres.find((c) => c.title === 'Coca-Cola');
    assert.ok(coca);
    assert.equal(coca.articles.length, 2);
    assert.ok(
      catalog.warnings.some((w) => w.toLowerCase().includes('historique')),
    );
  });

  it('skips blank titles and defaults missing numbers to 0 / 1', () => {
    const csv = [
      'calibre_title,article_id,designation,price,cost,barcode_ean,units_in_one_piece,category',
      ',1,orphan,10,5,x,1,',
      'Thé,1,Thé vert,,abc,,,',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);
    assert.equal(catalog.calibres.length, 1);
    const tea = catalog.calibres[0];
    assert.equal(tea.title, 'Thé');
    assert.equal(tea.articles[0].price, 0);
    assert.equal(tea.articles[0].cost, 0);
    assert.equal(tea.articles[0].unitsInOnePiece, 1);
    assert.ok(catalog.warnings.length >= 1);
  });

  it('supports a compact 4-column weebi-style sheet (one variant per row)', () => {
    const csv = [
      'Nom,Prix,Coût,Code barre',
      'Sucre,100,90,S1213',
      'Chocolat,200,180,S1213',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);
    assert.equal(catalog.calibres.length, 2);
    assert.equal(catalog.calibres[0].title, 'Sucre');
    assert.equal(catalog.calibres[0].articles[0].price, 100);
    assert.equal(catalog.calibres[0].articles[0].barcodeEan, 'S1213');
    assert.equal(catalog.calibres[1].articles[0].designation, 'Chocolat');
  });
});
