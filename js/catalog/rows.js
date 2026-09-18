/** Row Type values (spreadsheet "Type" column). */
export const ROW_TYPE = {
  PRODUIT: 'Produit',
  PARENT: 'Produit parent',
  SOUS: 'Sous-produit',
};

/** Spreadsheet column indexes. */
export const COL = {
  PHOTO: 0,
  TYPE: 1,
  NAME: 2,
  LOT: 3,
  PRICE: 4,
  COST: 5,
  BARCODE: 6,
  CATEGORY: 7,
  PARENT: 8,
};

export const ROW_HEADERS = [
  'photo',
  'type',
  'name',
  'lot',
  'price',
  'cost',
  'barcode_ean',
  'category',
  'parent',
];

function parseNum(value, fallback = 0) {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normType(raw) {
  const t = String(raw ?? '').trim();
  if (t === ROW_TYPE.PARENT || t === ROW_TYPE.SOUS || t === ROW_TYPE.PRODUIT) {
    return t;
  }
  return ROW_TYPE.PRODUIT;
}

/**
 * @param {Array<{ calibreTitle: string, id: number, data: Uint8Array|number[] }>} photos
 * @returns {{ calibreTitle: string, id: number, data: Uint8Array|number[], extension?: string }|null}
 */
export function photoForRow(calibreTitle, articleId, photos = []) {
  const title = String(calibreTitle ?? '').trim();
  if (!title) {
    return null;
  }
  const aid = Math.trunc(Number(articleId) || 0);
  if (aid > 0) {
    const variant = photos.find(
      (p) => p.calibreTitle === title && p.id === aid,
    );
    if (variant) {
      return variant;
    }
  }
  return (
    photos.find((p) => p.calibreTitle === title && p.id === 0) ?? null
  );
}

/**
 * Photo lookup key for a grid row (type-aware).
 * @param {Array<any>} row
 * @param {Array<Array<any>>} [allRows] used to resolve sous-produit article index
 */
export function photoKeyForGridRow(row, allRows = []) {
  const type = normType(row?.[COL.TYPE]);
  const name = String(row?.[COL.NAME] ?? '').trim();
  const parent = String(row?.[COL.PARENT] ?? '').trim();
  if (type === ROW_TYPE.SOUS) {
    if (!parent) {
      return { calibreTitle: '', articleId: 0 };
    }
    const rowIndex = allRows.indexOf(row);
    let idx = 0;
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (normType(r[COL.TYPE]) !== ROW_TYPE.SOUS) {
        continue;
      }
      if (String(r[COL.PARENT] ?? '').trim() !== parent) {
        continue;
      }
      idx += 1;
      if (i === rowIndex) {
        return { calibreTitle: parent, articleId: idx };
      }
    }
    return { calibreTitle: parent, articleId: Math.max(1, idx) };
  }
  return { calibreTitle: name, articleId: 0 };
}

/**
 * @param {Array<{ calibreTitle: string, id: number, data: Uint8Array|number[] }>} photos
 */
export function photoStatusForRow(calibreTitle, articleId, photos = []) {
  const photo = photoForRow(calibreTitle, articleId, photos);
  if (!photo) {
    return '＋';
  }
  return photo.id > 0 ? 'ligne' : 'produit';
}

function emptyPhotoSlot() {
  return '';
}

/**
 * @param {{ calibres: object[], categories?: object[], photos?: object[] }} catalog
 * @returns {Array<Array<string|number>>}
 */
export function catalogToRows(catalog) {
  const photos = catalog.photos ?? [];
  /** @type {Map<string, string>} */
  const titleToCategory = new Map();
  for (const cat of catalog.categories ?? []) {
    for (const t of cat.calibreTitles ?? []) {
      titleToCategory.set(t, cat.title);
    }
  }

  const rows = [];
  for (const calibre of catalog.calibres ?? []) {
    const title = String(calibre.title ?? '').trim();
    if (!title) {
      continue;
    }
    const category = titleToCategory.get(title) ?? '';
    const articles = calibre.articles ?? [];

    if (articles.length === 0) {
      rows.push([
        emptyPhotoSlot(),
        ROW_TYPE.PARENT,
        title,
        '',
        '',
        '',
        '',
        category,
        '',
      ]);
      continue;
    }

    if (articles.length === 1) {
      const a = articles[0];
      const designation = String(a.designation ?? title).trim() || title;
      const lot =
        Number(a.unitsInOnePiece) > 0 ? Number(a.unitsInOnePiece) : 1;
      rows.push([
        emptyPhotoSlot(),
        ROW_TYPE.PRODUIT,
        designation,
        lot,
        Number(a.price) || 0,
        Number(a.cost) || 0,
        String(a.barcodeEan ?? ''),
        category,
        '',
      ]);
      continue;
    }

    rows.push([
      emptyPhotoSlot(),
      ROW_TYPE.PARENT,
      title,
      '',
      '',
      '',
      '',
      category,
      '',
    ]);
    for (const a of articles) {
      const articleId = a.id != null ? Math.trunc(a.id) : 1;
      const lot =
        Number(a.unitsInOnePiece) > 0 ? Number(a.unitsInOnePiece) : 1;
      rows.push([
        emptyPhotoSlot(),
        ROW_TYPE.SOUS,
        String(a.designation ?? title).trim() || title,
        lot,
        Number(a.price) || 0,
        Number(a.cost) || 0,
        String(a.barcodeEan ?? ''),
        category,
        title,
      ]);
      void articleId;
    }
  }
  return rows;
}

/**
 * @param {Array<Array<any>>} rows
 * @param {Array<{ calibreTitle: string, id: number, data: any, extension?: string }>} [photos]
 */
export function rowsToCatalog(rows, photos = []) {
  /** @type {Map<string, { title: string, articles: object[] }>} */
  const byTitle = new Map();
  /** @type {Map<string, Set<string>>} */
  const categoryToTitles = new Map();
  /** @type {string[]} */
  const warnings = [];
  /** @type {Set<string>} */
  const parentNames = new Set();

  const ensureCalibre = (title) => {
    if (!byTitle.has(title)) {
      byTitle.set(title, { title, articles: [] });
    }
    return byTitle.get(title);
  };

  const addCategory = (category, calibreTitle) => {
    const cat = String(category ?? '').trim();
    if (!cat || !calibreTitle) {
      return;
    }
    if (!categoryToTitles.has(cat)) {
      categoryToTitles.set(cat, new Set());
    }
    categoryToTitles.get(cat).add(calibreTitle);
  };

  // First pass: register parents and standalone produits
  for (const row of rows ?? []) {
    const type = normType(row[COL.TYPE]);
    const name = String(row[COL.NAME] ?? '').trim();
    if (!name) {
      continue;
    }

    if (type === ROW_TYPE.PARENT) {
      parentNames.add(name);
      ensureCalibre(name);
      addCategory(row[COL.CATEGORY], name);
      continue;
    }

    if (type === ROW_TYPE.PRODUIT) {
      const calibre = ensureCalibre(name);
      let lot = parseNum(row[COL.LOT], 1);
      if (lot <= 0) {
        lot = 1;
      }
      calibre.articles = [
        {
          id: 1,
          designation: name,
          price: parseNum(row[COL.PRICE], 0),
          cost: parseNum(row[COL.COST], 0),
          barcodeEan: String(row[COL.BARCODE] ?? '').trim(),
          unitsInOnePiece: lot,
        },
      ];
      addCategory(row[COL.CATEGORY], name);
    }
  }

  // Second pass: sous-produits
  /** @type {Map<string, number>} */
  const nextIdByParent = new Map();

  for (const row of rows ?? []) {
    const type = normType(row[COL.TYPE]);
    if (type !== ROW_TYPE.SOUS) {
      continue;
    }
    const name = String(row[COL.NAME] ?? '').trim();
    const parent = String(row[COL.PARENT] ?? '').trim();
    if (!name) {
      continue;
    }
    if (!parent || !parentNames.has(parent)) {
      warnings.push(
        `sous-produit « ${name || '?'} » orphelin (parent « ${parent || '—'} » introuvable), ignoré`,
      );
      continue;
    }
    const calibre = ensureCalibre(parent);
    const id = (nextIdByParent.get(parent) ?? 0) + 1;
    nextIdByParent.set(parent, id);
    let lot = parseNum(row[COL.LOT], 1);
    if (lot <= 0) {
      lot = 1;
    }
    calibre.articles.push({
      id,
      designation: name,
      price: parseNum(row[COL.PRICE], 0),
      cost: parseNum(row[COL.COST], 0),
      barcodeEan: String(row[COL.BARCODE] ?? '').trim(),
      unitsInOnePiece: lot,
    });
  }

  // Remap photos: keep those whose calibre still exists; article ids for sous-produits
  // are reassigned 1..n — keep id=0 (parent/standalone) and article photos by sequential
  // rematch using previous photos filtered by calibre title only for id=0 always;
  // for id>0 keep if id still valid after rebuild.
  const keptTitles = new Set(byTitle.keys());
  /** @type {typeof photos} */
  const keptPhotos = [];
  for (const p of photos ?? []) {
    const ct = String(p.calibreTitle ?? '').trim();
    if (!keptTitles.has(ct)) {
      continue;
    }
    const calibre = byTitle.get(ct);
    const maxId = (calibre?.articles ?? []).reduce(
      (m, a) => Math.max(m, a.id ?? 0),
      0,
    );
    const pid = Math.trunc(p.id ?? 0);
    if (pid === 0 || pid <= maxId) {
      keptPhotos.push(p);
    }
  }

  return {
    calibres: [...byTitle.values()],
    categories: [...categoryToTitles.entries()].map(([title, set]) => ({
      title,
      color: 4294198070,
      calibreTitles: [...set],
    })),
    photos: keptPhotos,
    warnings,
  };
}

/**
 * @param {{ calibres: object[], categories: object[], photos: object[], warnings?: string[] }} catalog
 * @param {string} calibreTitle
 */
export function deleteCalibreFromCatalog(catalog, calibreTitle) {
  const title = String(calibreTitle ?? '').trim();
  return {
    ...catalog,
    calibres: (catalog.calibres ?? []).filter((c) => c.title !== title),
    photos: (catalog.photos ?? []).filter((p) => p.calibreTitle !== title),
    categories: (catalog.categories ?? [])
      .map((cat) => ({
        ...cat,
        calibreTitles: (cat.calibreTitles ?? []).filter((t) => t !== title),
      }))
      .filter((cat) => (cat.calibreTitles ?? []).length > 0),
  };
}

/**
 * Whether a sell field (lot/price/cost/barcode) is editable for this type.
 * @param {string} type
 */
export function sellFieldsEditable(type) {
  const t = normType(type);
  return t === ROW_TYPE.PRODUIT || t === ROW_TYPE.SOUS;
}

/**
 * Whether category is editable for this type.
 * @param {string} type
 */
export function categoryEditable(type) {
  const t = normType(type);
  return t === ROW_TYPE.PRODUIT || t === ROW_TYPE.PARENT;
}
