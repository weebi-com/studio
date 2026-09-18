/**
 * Parse Weebi app articles JSON export into a Studio catalog.
 * Expects an array of Calibre-like objects with nested articles.
 */

function parseNum(value, fallback = 0) {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {string|object} raw
 * @returns {{ calibres: object[], categories: object[], photos: object[], warnings: string[] }}
 */
export function parseWeebiArticlesJson(raw) {
  const warnings = [];
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return {
      calibres: [],
      categories: [],
      photos: [],
      warnings: [`JSON invalide: ${e.message}`],
    };
  }

  if (!Array.isArray(data)) {
    return {
      calibres: [],
      categories: [],
      photos: [],
      warnings: ['JSON Weebi attendu: tableau de calibres'],
    };
  }

  const calibres = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const kind = String(item.kind ?? 'retail').toLowerCase();
    if (kind === 'basket') {
      warnings.push(
        `calibre "${item.title ?? '?'}" (basket) ignoré — retail uniquement en v1`,
      );
      continue;
    }
    if (kind === 'uncountable') {
      warnings.push(
        `calibre "${item.title ?? '?'}" (uncountable) ignoré — retail uniquement en v1`,
      );
      continue;
    }

    const title = String(item.title ?? '').trim();
    if (!title) {
      warnings.push('calibre sans titre ignoré');
      continue;
    }

    const articlesRaw = Array.isArray(item.articles) ? item.articles : [];
    const articles = articlesRaw.map((a, idx) => {
      let units = parseNum(a?.unitsInOnePiece, 1);
      if (units <= 0) {
        units = 1;
      }
      return {
        id: a?.id != null ? Math.trunc(Number(a.id)) : idx + 1,
        designation: String(a?.designation ?? title).trim() || title,
        price: parseNum(a?.price, 0),
        cost: parseNum(a?.cost, 0),
        barcodeEan: String(a?.barcodeEAN ?? a?.barcodeEan ?? '').trim(),
        unitsInOnePiece: units,
      };
    });

    if (articles.length === 0) {
      articles.push({
        id: 1,
        designation: title,
        price: 0,
        cost: 0,
        barcodeEan: '',
        unitsInOnePiece: 1,
      });
    }

    calibres.push({
      tempId: item.id != null ? Math.trunc(Number(item.id)) : undefined,
      title,
      kind: 'retail',
      stockUnit: String(item.stockUnit ?? 'unit'),
      status: item.status !== false,
      articles,
    });
  }

  return {
    calibres,
    categories: [],
    photos: [],
    warnings,
  };
}
