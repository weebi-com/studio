import { SCHEMA_V1_SQL } from './schema_ddl.js';

/**
 * @param {{ initSqlJs?: Function }} options
 * @returns {Promise<Function>}
 */
async function resolveInitSqlJs(options = {}) {
  if (typeof options.initSqlJs === 'function') {
    return options.initSqlJs;
  }
  if (typeof globalThis.initSqlJs === 'function') {
    return globalThis.initSqlJs;
  }
  const mod = await import('sql.js');
  return mod.default ?? mod;
}

/**
 * Export an in-memory catalog to .db SQLite bytes.
 * Assigns sequential temp calibre ids starting at 1.
 *
 * @param {{
 *   calibres: Array<{
 *     title: string,
 *     articles: Array<{
 *       id?: number,
 *       designation: string,
 *       price: number,
 *       cost: number,
 *       barcodeEan?: string,
 *       unitsInOnePiece?: number,
 *     }>
 *   }>,
 *   categories?: Array<{ title: string, color?: number, calibreTitles: string[] }>,
 *   photos?: Array<{ calibreTitle: string, id: number, extension?: string, data: Uint8Array }>,
 * }} catalog
 * @param {{ initSqlJs?: Function, locateFile?: (file: string) => string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function exportWeebiBytes(catalog, options = {}) {
  const init = await resolveInitSqlJs(options);
  const SQL = await init(
    options.locateFile
      ? { locateFile: options.locateFile }
      : undefined,
  );
  const db = new SQL.Database();
  db.run(SCHEMA_V1_SQL);

  const now = new Date().toISOString();
  db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('created_at', ?)`, [
    now,
  ]);
  db.run(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('studio_version', ?)`,
    ['0.1.0'],
  );

  /** @type {Map<string, number>} */
  const titleToId = new Map();
  let nextCalibreId = 1;

  for (const calibre of catalog.calibres ?? []) {
    const title = String(calibre.title ?? '').trim();
    if (!title) {
      continue;
    }
    const calibreId = nextCalibreId++;
    titleToId.set(title, calibreId);
    db.run(
      `INSERT INTO calibres (id, title, kind, stock_unit, status, creation_date, update_date)
       VALUES (?, ?, 'retail', 'unit', 1, ?, ?)`,
      [calibreId, title, now, now],
    );

    const articles = calibre.articles ?? [];
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const articleId = a.id != null ? Math.trunc(a.id) : i + 1;
      db.run(
        `INSERT INTO articles
         (calibre_id, id, designation, price, cost, units_in_one_piece, barcode_ean, status, creation_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          calibreId,
          articleId,
          String(a.designation ?? title).trim() || title,
          Number(a.price) || 0,
          Number(a.cost) || 0,
          Number(a.unitsInOnePiece) > 0 ? Number(a.unitsInOnePiece) : 1,
          String(a.barcodeEan ?? ''),
          now,
        ],
      );
    }
  }

  for (const cat of catalog.categories ?? []) {
    const catTitle = String(cat.title ?? '').trim();
    if (!catTitle) {
      continue;
    }
    db.run(
      `INSERT OR REPLACE INTO categories (title, color, creation_date, update_date)
       VALUES (?, ?, ?, ?)`,
      [catTitle, cat.color ?? 4294198070, now, now],
    );
    for (const calibreTitle of cat.calibreTitles ?? []) {
      const calibreId = titleToId.get(calibreTitle);
      if (calibreId == null) {
        continue;
      }
      db.run(
        `INSERT OR IGNORE INTO category_calibres (category_title, calibre_id)
         VALUES (?, ?)`,
        [catTitle, calibreId],
      );
    }
  }

  for (const photo of catalog.photos ?? []) {
    const calibreId = titleToId.get(photo.calibreTitle);
    if (calibreId == null || !photo.data) {
      continue;
    }
    db.run(
      `INSERT OR REPLACE INTO photos (calibre_id, id, extension, data)
       VALUES (?, ?, ?, ?)`,
      [
        calibreId,
        Math.trunc(photo.id ?? 0),
        photo.extension ?? 'jpeg',
        photo.data,
      ],
    );
  }

  const bytes = db.export();
  db.close();
  return bytes;
}
