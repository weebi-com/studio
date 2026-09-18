import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function openSchemaDb() {
  const SQL = await initSqlJs();
  const ddl = readFileSync(join(root, 'schema', 'v1.sql'), 'utf8');
  const db = new SQL.Database();
  db.run(ddl);
  return db;
}

describe('schema v1', () => {
  it('VERSION file is 1', () => {
    const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
    assert.equal(version, '1');
  });

  it('applies DDL and sets schema_version=1', async () => {
    const db = await openSchemaDb();
    const row = db.exec(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    assert.equal(row[0].values[0][0], '1');
    const kind = db.exec("SELECT value FROM meta WHERE key = 'kind'");
    assert.equal(kind[0].values[0][0], 'weebi_catalog');
    db.close();
  });

  it('creates required tables', async () => {
    const db = await openSchemaDb();
    const tables = db
      .exec(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )[0]
      .values.map((r) => r[0]);
    for (const name of [
      'articles',
      'calibres',
      'categories',
      'category_calibres',
      'meta',
      'photos',
    ]) {
      assert.ok(tables.includes(name), `missing table ${name}`);
    }
    db.close();
  });

  it('accepts a retail calibre with two variants and a category link', async () => {
    const db = await openSchemaDb();
    db.run(
      `INSERT INTO calibres (id, title, kind, stock_unit, status)
       VALUES (1, 'Coca-Cola', 'retail', 'unit', 1)`,
    );
    db.run(
      `INSERT INTO articles
       (calibre_id, id, designation, price, cost, units_in_one_piece, barcode_ean)
       VALUES
       (1, 1, 'Coca-Cola 33cl', 500, 300, 1, '5449000000996'),
       (1, 2, 'Coca-Cola 1.5L', 1200, 800, 1, '5449000054227')`,
    );
    db.run(
      `INSERT INTO categories (title, color) VALUES ('Boissons', 4294198070)`,
    );
    db.run(
      `INSERT INTO category_calibres (category_title, calibre_id)
       VALUES ('Boissons', 1)`,
    );

    const countArticles = db.exec(
      'SELECT COUNT(*) FROM articles WHERE calibre_id = 1',
    );
    assert.equal(countArticles[0].values[0][0], 2);
    const link = db.exec(
      "SELECT calibre_id FROM category_calibres WHERE category_title = 'Boissons'",
    );
    assert.equal(link[0].values[0][0], 1);
    db.close();
  });

  it('accepts calibre default photo (id=0) and variant photo', async () => {
    const db = await openSchemaDb();
    db.run(
      `INSERT INTO calibres (id, title) VALUES (1, 'Sucre')`,
    );
    db.run(
      `INSERT INTO articles (calibre_id, id, designation, price)
       VALUES (1, 1, 'Sucre 1kg', 100)`,
    );
    const blob = new Uint8Array([0xff, 0xd8, 0xff]); // tiny fake jpeg header
    db.run(
      `INSERT INTO photos (calibre_id, id, extension, data) VALUES (?, ?, ?, ?)`,
      [1, 0, 'jpeg', blob],
    );
    db.run(
      `INSERT INTO photos (calibre_id, id, extension, data) VALUES (?, ?, ?, ?)`,
      [1, 1, 'jpeg', blob],
    );
    const n = db.exec('SELECT COUNT(*) FROM photos')[0].values[0][0];
    assert.equal(n, 2);
    db.close();
  });
});
