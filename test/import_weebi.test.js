import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { exportWeebiBytes } from '../js/catalog/export_weebi.js';
import { importWeebiBytes } from '../js/catalog/import_weebi.js';
import { SCHEMA_V1_SQL } from '../js/catalog/schema_ddl.js';

function photoBytesEqual(a, b) {
  const aa = a instanceof Uint8Array ? a : Uint8Array.from(a ?? []);
  const bb = b instanceof Uint8Array ? b : Uint8Array.from(b ?? []);
  if (aa.length !== bb.length) {
    return false;
  }
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) {
      return false;
    }
  }
  return true;
}

describe('importWeebiBytes', () => {
  it('rejects non-SQLite bytes', async () => {
    await assert.rejects(
      () => importWeebiBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
      /en-tête SQLite/,
    );
  });

  it('rejects empty / too short payload', async () => {
    await assert.rejects(
      () => importWeebiBytes(new Uint8Array(4)),
      /vide ou invalide/,
    );
  });

  it('rejects unsupported schema_version', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(SCHEMA_V1_SQL);
    db.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '99')",
    );
    const bytes = db.export();
    db.close();

    await assert.rejects(
      () => importWeebiBytes(bytes),
      /version de schéma non supportée/,
    );
  });

  it('rejects invalid kind', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(SCHEMA_V1_SQL);
    db.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('kind', 'other')",
    );
    const bytes = db.export();
    db.close();

    await assert.rejects(() => importWeebiBytes(bytes), /kind invalide/);
  });

  it('roundtrips catalog with categories and photo BLOBs', async () => {
    const calibreJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const variantJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    const catalog = {
      calibres: [
        {
          title: 'Coca-Cola',
          articles: [
            {
              id: 1,
              designation: 'Coca-Cola 33cl',
              price: 500,
              cost: 300,
              barcodeEan: '5449000000996',
              unitsInOnePiece: 1,
            },
            {
              id: 2,
              designation: 'Coca-Cola 1.5L',
              price: 1200,
              cost: 800,
              barcodeEan: '5449000054227',
              unitsInOnePiece: 1,
            },
          ],
        },
        {
          title: 'Sucre',
          articles: [
            {
              id: 1,
              designation: 'Sucre 1kg',
              price: 100,
              cost: 80,
              barcodeEan: '',
              unitsInOnePiece: 1,
            },
          ],
        },
      ],
      categories: [
        { title: 'Boissons', color: 4294198070, calibreTitles: ['Coca-Cola'] },
      ],
      photos: [
        {
          calibreTitle: 'Coca-Cola',
          id: 0,
          extension: 'jpeg',
          data: calibreJpeg,
        },
        {
          calibreTitle: 'Coca-Cola',
          id: 2,
          extension: 'jpeg',
          data: variantJpeg,
        },
      ],
    };

    const bytes = await exportWeebiBytes(catalog);
    const imported = await importWeebiBytes(bytes);

    assert.equal(imported.calibres.length, 2);
    assert.equal(imported.calibres[0].title, 'Coca-Cola');
    assert.equal(imported.calibres[0].articles.length, 2);
    assert.equal(imported.calibres[0].articles[1].designation, 'Coca-Cola 1.5L');
    assert.equal(imported.calibres[0].articles[1].barcodeEan, '5449000054227');
    assert.equal(imported.calibres[1].title, 'Sucre');

    assert.equal(imported.categories.length, 1);
    assert.equal(imported.categories[0].title, 'Boissons');
    assert.deepEqual(imported.categories[0].calibreTitles, ['Coca-Cola']);

    assert.equal(imported.photos.length, 2);
    assert.equal(imported.photos[0].calibreTitle, 'Coca-Cola');
    assert.equal(imported.photos[0].id, 0);
    assert.ok(photoBytesEqual(imported.photos[0].data, calibreJpeg));
    assert.equal(imported.photos[1].id, 2);
    assert.ok(photoBytesEqual(imported.photos[1].data, variantJpeg));
    assert.deepEqual(imported.warnings, []);
  });

  it('skips non-retail calibres with a warning', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(SCHEMA_V1_SQL);
    db.run(
      `INSERT INTO calibres (id, title, kind, stock_unit, status)
       VALUES (1, 'Panier', 'basket', 'unit', 1)`,
    );
    db.run(
      `INSERT INTO articles
       (calibre_id, id, designation, price, cost, units_in_one_piece, barcode_ean, status)
       VALUES (1, 1, 'Panier', 0, 0, 1, '', 1)`,
    );
    const bytes = db.export();
    db.close();

    const imported = await importWeebiBytes(bytes);
    assert.equal(imported.calibres.length, 0);
    assert.equal(imported.warnings.length, 1);
    assert.match(imported.warnings[0], /basket/);
  });
});
