import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { exportWeebiBytes } from '../js/catalog/export_weebi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

describe('exportWeebiBytes', () => {
  it('writes a valid .weebi sqlite pack with remappable temp ids', async () => {
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
      photos: [],
    };

    const bytes = await exportWeebiBytes(catalog);
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 100);
    // SQLite magic header
    assert.equal(String.fromCharCode(...bytes.slice(0, 6)), 'SQLite');

    const SQL = await initSqlJs();
    const db = new SQL.Database(bytes);
    const version = db.exec(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    )[0].values[0][0];
    assert.equal(version, '1');

    const calibres = db.exec('SELECT id, title FROM calibres ORDER BY id');
    assert.equal(calibres[0].values.length, 2);
    assert.equal(calibres[0].values[0][1], 'Coca-Cola');

    const articles = db.exec(
      'SELECT calibre_id, id, designation, price FROM articles ORDER BY calibre_id, id',
    );
    assert.equal(articles[0].values.length, 3);
    assert.equal(articles[0].values[1][2], 'Coca-Cola 1.5L');

    const links = db.exec(
      'SELECT category_title, calibre_id FROM category_calibres',
    );
    assert.equal(links[0].values[0][0], 'Boissons');
    assert.equal(links[0].values[0][1], 1);

    db.close();
  });

  it('embeds photo BLOBs for calibre (id=0) and variant', async () => {
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
              barcodeEan: '',
              unitsInOnePiece: 1,
            },
            {
              id: 2,
              designation: 'Coca-Cola 1.5L',
              price: 1200,
              cost: 800,
              barcodeEan: '',
              unitsInOnePiece: 1,
            },
          ],
        },
      ],
      categories: [],
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
    const SQL = await initSqlJs();
    const db = new SQL.Database(bytes);
    const rows = db.exec(
      'SELECT calibre_id, id, extension, length(data) FROM photos ORDER BY id',
    );
    assert.equal(rows[0].values.length, 2);
    assert.deepEqual(rows[0].values[0], [1, 0, 'jpeg', calibreJpeg.length]);
    assert.deepEqual(rows[0].values[1], [1, 2, 'jpeg', variantJpeg.length]);

    const blob0 = db.exec(
      'SELECT data FROM photos WHERE calibre_id = 1 AND id = 0',
    )[0].values[0][0];
    assert.ok(blob0 instanceof Uint8Array || Array.isArray(blob0));
    const asArr = blob0 instanceof Uint8Array ? blob0 : Uint8Array.from(blob0);
    assert.deepEqual([...asArr], [...calibreJpeg]);
    db.close();
  });

  it('uses the same DDL as schema/v1.sql', async () => {
    const ddl = readFileSync(join(root, 'schema', 'v1.sql'), 'utf8');
    assert.match(ddl, /CREATE TABLE calibres/);
    assert.match(ddl, /CREATE TABLE articles/);
    assert.match(ddl, /schema_version/);
  });
});
