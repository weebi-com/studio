import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { parseCatalogCsv } from '../js/catalog/parse_csv.js';
import { exportWeebiBytes } from '../js/catalog/export_weebi.js';
import { importWeebiBytes } from '../js/catalog/import_weebi.js';

describe('csv → .db roundtrip', () => {
  it('exports parsed CSV and reopens counts', async () => {
    const csv = [
      'calibre_title,article_id,designation,price,cost,barcode_ean,units_in_one_piece,category',
      'Coca-Cola,1,Coca-Cola 33cl,500,300,5449000000996,1,Boissons',
      'Coca-Cola,2,Coca-Cola 1.5L,1200,800,5449000054227,1,Boissons',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);
    const bytes = await exportWeebiBytes(catalog);

    const SQL = await initSqlJs();
    const db = new SQL.Database(bytes);
    assert.equal(
      db.exec('SELECT COUNT(*) FROM calibres')[0].values[0][0],
      1,
    );
    assert.equal(
      db.exec('SELECT COUNT(*) FROM articles')[0].values[0][0],
      2,
    );
    assert.equal(
      db.exec('SELECT COUNT(*) FROM categories')[0].values[0][0],
      1,
    );
    db.close();
  });

  it('reopens via importWeebiBytes with catalog equality', async () => {
    const csv = [
      'calibre_title,article_id,designation,price,cost,barcode_ean,units_in_one_piece,category',
      'Coca-Cola,1,Coca-Cola 33cl,500,300,5449000000996,1,Boissons',
      'Coca-Cola,2,Coca-Cola 1.5L,1200,800,5449000054227,1,Boissons',
    ].join('\n');

    const catalog = parseCatalogCsv(csv);
    const bytes = await exportWeebiBytes(catalog);
    const imported = await importWeebiBytes(bytes);

    assert.equal(imported.calibres.length, catalog.calibres.length);
    assert.equal(imported.calibres[0].title, 'Coca-Cola');
    assert.deepEqual(
      imported.calibres[0].articles.map((a) => ({
        id: a.id,
        designation: a.designation,
        price: a.price,
        cost: a.cost,
        barcodeEan: a.barcodeEan,
        unitsInOnePiece: a.unitsInOnePiece,
      })),
      catalog.calibres[0].articles.map((a) => ({
        id: a.id,
        designation: a.designation,
        price: a.price,
        cost: a.cost,
        barcodeEan: a.barcodeEan,
        unitsInOnePiece: a.unitsInOnePiece,
      })),
    );
    assert.equal(imported.categories.length, 1);
    assert.equal(imported.categories[0].title, 'Boissons');
    assert.deepEqual(imported.categories[0].calibreTitles, ['Coca-Cola']);
    assert.deepEqual(imported.warnings, []);
  });
});
