/**
 * Import a .db SQLite catalog pack into the in-memory Studio catalog.
 * Mirror of weebi_app WeebiCatalogReader — keep schema checks in sync with schema/v1.sql.
 */

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

function asUint8(raw) {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Uint8Array.from(raw);
  }
  if (raw && typeof raw === 'object' && ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return new Uint8Array();
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params.length > 0) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

/**
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{ initSqlJs?: Function, locateFile?: (file: string) => string }} [options]
 * @returns {Promise<{
 *   calibres: object[],
 *   categories: object[],
 *   photos: object[],
 *   warnings: string[],
 * }>}
 */
export async function importWeebiBytes(bytes, options = {}) {
  const warnings = [];
  const raw =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : Uint8Array.from(bytes ?? []);

  if (raw.length < 16) {
    throw new Error('fichier .db vide ou invalide');
  }
  const magic = String.fromCharCode(...raw.slice(0, 6));
  if (magic !== 'SQLite') {
    throw new Error('fichier .db invalide : en-tête SQLite manquant');
  }

  const init = await resolveInitSqlJs(options);
  const SQL = await init(
    options.locateFile ? { locateFile: options.locateFile } : undefined,
  );
  const db = new SQL.Database(raw);

  try {
    const versionRows = queryAll(
      db,
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    if (versionRows.length === 0) {
      throw new Error('fichier .db invalide : schema_version manquant');
    }
    const schemaVersion = Number.parseInt(String(versionRows[0].value), 10);
    if (schemaVersion !== 1) {
      throw new Error(
        `version de schéma non supportée: ${schemaVersion} (attendu: 1)`,
      );
    }

    const kindRows = queryAll(db, "SELECT value FROM meta WHERE key = 'kind'");
    if (
      kindRows.length > 0 &&
      String(kindRows[0].value) !== 'weebi_catalog'
    ) {
      throw new Error(`kind invalide: ${kindRows[0].value}`);
    }

    /** @type {Map<number, string>} */
    const idToTitle = new Map();
    const calibres = [];
    const calibreRows = queryAll(
      db,
      'SELECT id, title, kind, stock_unit, status FROM calibres ORDER BY id',
    );

    for (const row of calibreRows) {
      const calibreId = Math.trunc(Number(row.id));
      const title = String(row.title ?? '').trim();
      const kind = String(row.kind ?? 'retail').toLowerCase();

      if (!title) {
        warnings.push(`calibre id=${calibreId} sans titre ignoré`);
        continue;
      }
      if (kind !== 'retail') {
        warnings.push(
          `calibre "${title}" (${kind}) ignoré — retail uniquement en v1`,
        );
        continue;
      }

      idToTitle.set(calibreId, title);

      const articleRows = queryAll(
        db,
        `SELECT id, designation, price, cost, units_in_one_piece, barcode_ean, status
         FROM articles WHERE calibre_id = ? ORDER BY id`,
        [calibreId],
      );

      const articles = articleRows.map((a, idx) => {
        let units = Number(a.units_in_one_piece);
        if (!Number.isFinite(units) || units <= 0) {
          units = 1;
        }
        return {
          id: a.id != null ? Math.trunc(Number(a.id)) : idx + 1,
          designation: String(a.designation ?? title).trim() || title,
          price: Number(a.price) || 0,
          cost: Number(a.cost) || 0,
          barcodeEan: String(a.barcode_ean ?? ''),
          unitsInOnePiece: units,
        };
      });

      calibres.push({ title, articles });
    }

    const categories = [];
    const categoryRows = queryAll(
      db,
      'SELECT title, color FROM categories ORDER BY title',
    );
    for (const row of categoryRows) {
      const catTitle = String(row.title ?? '').trim();
      if (!catTitle) {
        continue;
      }
      const linkRows = queryAll(
        db,
        'SELECT calibre_id FROM category_calibres WHERE category_title = ?',
        [catTitle],
      );
      const calibreTitles = [];
      for (const link of linkRows) {
        const t = idToTitle.get(Math.trunc(Number(link.calibre_id)));
        if (t) {
          calibreTitles.push(t);
        }
      }
      if (calibreTitles.length === 0) {
        continue;
      }
      categories.push({
        title: catTitle,
        color: Number(row.color) || 4294198070,
        calibreTitles,
      });
    }

    const photos = [];
    const photoRows = queryAll(
      db,
      'SELECT calibre_id, id, extension, data FROM photos ORDER BY calibre_id, id',
    );
    for (const row of photoRows) {
      const title = idToTitle.get(Math.trunc(Number(row.calibre_id)));
      if (!title) {
        continue;
      }
      const data = asUint8(row.data);
      if (data.length === 0) {
        warnings.push(`photo calibre "${title}" id=${row.id} vide ignorée`);
        continue;
      }
      photos.push({
        calibreTitle: title,
        id: Math.trunc(Number(row.id) || 0),
        extension: String(row.extension ?? 'jpeg'),
        data,
      });
    }

    return { calibres, categories, photos, warnings };
  } finally {
    db.close();
  }
}
