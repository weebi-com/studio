/**
 * Parse a catalog CSV into an in-memory catalog.
 *
 * Formats:
 * - Compact Weebi 4-col: Nom/Prix/Coût/Code barre (1 variant per calibre)
 * - Studio type-based: type,name,lot,price,cost,barcode_ean,category,parent
 * - Legacy Studio 8-col: calibre_title,article_id,designation,... (best-effort + warning)
 */

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function parseNum(value, fallback = 0) {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHeader(cell) {
  return String(cell ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isCompactHeader(headers) {
  const h0 = normalizeHeader(headers[0]);
  return (
    headers.length <= 4 &&
    (h0 === 'nom' || h0 === 'titre' || h0 === 'name' || h0 === 'title')
  );
}

function isLegacyStudioHeader(headers) {
  const h0 = normalizeHeader(headers[0]);
  return h0 === 'calibre_title' || h0 === 'calibre title';
}

function isTypeStudioHeader(headers) {
  const h0 = normalizeHeader(headers[0]);
  return h0 === 'type';
}

/** Weebi app export: id,nom,unit,nom,qt/unité,prix,cout,codebarre,date_creation,... */
function isWeebiExportHeader(headers) {
  const h0 = normalizeHeader(headers[0]);
  const joined = headers.map(normalizeHeader).join('|');
  return h0 === 'id' && joined.includes('unit') && joined.includes('prix');
}

/**
 * @param {string} csvText
 * @returns {{ calibres: object[], categories: object[], photos?: object[], warnings: string[] }}
 */
export function parseCatalogCsv(csvText) {
  const warnings = [];
  const lines = String(csvText)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { calibres: [], categories: [], photos: [], warnings: ['fichier CSV vide'] };
  }

  const headerCells = splitCsvLine(lines[0]);
  const dataLines = lines.slice(1);

  /** @type {Map<string, { title: string, articles: object[], tempId?: number }>} */
  const byTitle = new Map();
  /** @type {Map<string, Set<string>>} */
  const categoryToTitles = new Map();

  const ensureCalibre = (title, tempId) => {
    if (!byTitle.has(title)) {
      byTitle.set(title, { title, articles: [], tempId });
    }
    return byTitle.get(title);
  };

  const addCategory = (category, calibreTitle) => {
    if (!category || !calibreTitle) {
      return;
    }
    if (!categoryToTitles.has(category)) {
      categoryToTitles.set(category, new Set());
    }
    categoryToTitles.get(category).add(calibreTitle);
  };

  if (isTypeStudioHeader(headerCells)) {
    /** @type {Map<string, number>} */
    const nextId = new Map();

    for (let i = 0; i < dataLines.length; i++) {
      const row = splitCsvLine(dataLines[i]);
      const type = (row[0] ?? '').trim();
      const name = (row[1] ?? '').trim();
      if (!name) {
        continue;
      }
      if (type === 'Article parent' || type === 'Produit parent') {
        ensureCalibre(name);
        addCategory((row[6] ?? '').trim(), name);
        continue;
      }
      if (type === 'Sous-article' || type === 'Sous-produit') {
        const parent = (row[7] ?? '').trim();
        if (!parent) {
          warnings.push(`ligne ${i + 2} : sous-article sans parent, ignorée`);
          continue;
        }
        const calibre = ensureCalibre(parent);
        const id = (nextId.get(parent) ?? 0) + 1;
        nextId.set(parent, id);
        let lot = parseNum(row[2], 1);
        if (lot <= 0) {
          lot = 1;
        }
        calibre.articles.push({
          id,
          designation: name,
          price: parseNum(row[3], 0),
          cost: parseNum(row[4], 0),
          barcodeEan: (row[5] ?? '').trim(),
          unitsInOnePiece: lot,
        });
        continue;
      }
      const calibre = ensureCalibre(name);
      let lot = parseNum(row[2], 1);
      if (lot <= 0) {
        lot = 1;
      }
      calibre.articles = [
        {
          id: 1,
          designation: name,
          price: parseNum(row[3], 0),
          cost: parseNum(row[4], 0),
          barcodeEan: (row[5] ?? '').trim(),
          unitsInOnePiece: lot,
        },
      ];
      addCategory((row[6] ?? '').trim(), name);
    }
  } else if (isLegacyStudioHeader(headerCells)) {
    warnings.push(
      'CSV Studio historique (calibre_title,…) détecté — préférez le format type,name,lot,…',
    );
    for (let i = 0; i < dataLines.length; i++) {
      const row = splitCsvLine(dataLines[i]);
      const title = (row[0] ?? '').trim();
      if (!title) {
        warnings.push(`ligne ${i + 2} : titre calibre manquant, ignorée`);
        continue;
      }
      const articleId = Math.max(1, Math.trunc(parseNum(row[1], 1)));
      const designation = (row[2] ?? '').trim() || title;
      const price = parseNum(row[3], 0);
      const cost = parseNum(row[4], 0);
      if (
        row[3] != null &&
        String(row[3]).trim() !== '' &&
        Number.isNaN(Number(String(row[3]).replace(',', '.')))
      ) {
        warnings.push(`ligne ${i + 2} : prix invalide → 0`);
      }
      if (
        row[4] != null &&
        String(row[4]).trim() !== '' &&
        Number.isNaN(Number(String(row[4]).replace(',', '.')))
      ) {
        warnings.push(`ligne ${i + 2} : coût invalide → 0`);
      }
      const barcodeEan = (row[5] ?? '').trim();
      let unitsInOnePiece = parseNum(row[6], 1);
      if (unitsInOnePiece <= 0) {
        unitsInOnePiece = 1;
      }
      const category = (row[7] ?? '').trim();

      const calibre = ensureCalibre(title);
      const existing = calibre.articles.find((a) => a.id === articleId);
      const article = {
        id: articleId,
        designation,
        price,
        cost,
        barcodeEan,
        unitsInOnePiece,
      };
      if (existing) {
        Object.assign(existing, article);
      } else {
        calibre.articles.push(article);
      }
      addCategory(category, title);
    }
  } else if (isWeebiExportHeader(headerCells)) {
    warnings.push(
      'CSV export Weebi détecté: format incomplet (pas de code-barres réel, pas de catégories/photos). Préférez le JSON Weebi.',
    );
    for (let i = 0; i < dataLines.length; i++) {
      const row = splitCsvLine(dataLines[i]);
      const tempId = Math.trunc(parseNum(row[0], 0)) || undefined;
      const title = (row[1] ?? '').trim();
      if (!title) {
        warnings.push(`ligne ${i + 2} : titre manquant, ignorée`);
        continue;
      }
      const designation = (row[3] ?? '').trim() || title;
      let unitsInOnePiece = parseNum(row[4], 1);
      if (unitsInOnePiece <= 0) {
        unitsInOnePiece = 1;
      }
      const price = parseNum(row[5], 0);
      const cost = parseNum(row[6], 0);
      const calibre = ensureCalibre(title, tempId);
      if (tempId != null) {
        calibre.tempId = tempId;
      }
      calibre.articles.push({
        id: calibre.articles.length + 1,
        designation,
        price,
        cost,
        barcodeEan: '',
        unitsInOnePiece,
      });
    }
  } else if (isCompactHeader(headerCells) || headerCells.length >= 1) {
    for (let i = 0; i < dataLines.length; i++) {
      const row = splitCsvLine(dataLines[i]);
      const title = (row[0] ?? '').trim();
      if (!title) {
        warnings.push(`ligne ${i + 2} : titre manquant, ignorée`);
        continue;
      }
      const priceRaw = row[1];
      const costRaw = row[2];
      const price = parseNum(priceRaw, 0);
      const cost = parseNum(costRaw, 0);
      if (
        priceRaw != null &&
        String(priceRaw).trim() !== '' &&
        Number.isNaN(Number(String(priceRaw).replace(',', '.')))
      ) {
        warnings.push(`ligne ${i + 2} : prix invalide → 0`);
      }
      if (
        costRaw != null &&
        String(costRaw).trim() !== '' &&
        Number.isNaN(Number(String(costRaw).replace(',', '.')))
      ) {
        warnings.push(`ligne ${i + 2} : coût invalide → 0`);
      }
      const calibre = ensureCalibre(title);
      calibre.articles.push({
        id: calibre.articles.length + 1,
        designation: title,
        price,
        cost,
        barcodeEan: (row[3] ?? '').trim(),
        unitsInOnePiece: 1,
      });
    }
  }

  const categories = [...categoryToTitles.entries()].map(([title, set]) => ({
    title,
    color: 4294198070,
    calibreTitles: [...set],
  }));

  return {
    calibres: [...byTitle.values()],
    categories,
    photos: [],
    warnings,
  };
}
