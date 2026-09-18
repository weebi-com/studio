/**
 * Spreadsheet column indexes that must hold numbers.
 * 3 = Vendu par lots de, 4 = Prix, 5 = Coût
 */
export const NUMERIC_COLUMN_RULES = {
  3: {
    kind: 'number',
    minExclusive: 0,
    label: 'Vendu par lots de',
  },
  4: { kind: 'number', min: 0, label: 'Prix' },
  5: { kind: 'number', min: 0, label: 'Coût' },
};

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeNumericString(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
}

/**
 * Validate / coerce a numeric spreadsheet cell.
 * @param {number|string} colIndex
 * @param {unknown} raw
 * @returns {{ ok: true, value: number } | { ok: false, message: string }}
 */
export function validateNumericCell(colIndex, raw) {
  const rule = NUMERIC_COLUMN_RULES[Number(colIndex)];
  if (!rule) {
    return { ok: true, value: /** @type {any} */ (raw) };
  }

  const s = normalizeNumericString(raw);
  if (s === '') {
    return { ok: false, message: `${rule.label} : nombre requis.` };
  }

  if (rule.kind === 'integer') {
    if (!/^-?\d+$/.test(s)) {
      return { ok: false, message: `${rule.label} : entier attendu.` };
    }
    const n = Number(s);
    if (!Number.isFinite(n) || n < rule.min) {
      return {
        ok: false,
        message: `${rule.label} : entier ≥ ${rule.min} attendu.`,
      };
    }
    return { ok: true, value: Math.trunc(n) };
  }

  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return { ok: false, message: `${rule.label} : nombre attendu.` };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, message: `${rule.label} : nombre attendu.` };
  }
  if (rule.minExclusive != null && !(n > rule.minExclusive)) {
    return {
      ok: false,
      message: `${rule.label} : nombre > ${rule.minExclusive} attendu.`,
    };
  }
  if (rule.min != null && n < rule.min) {
    return {
      ok: false,
      message: `${rule.label} : nombre ≥ ${rule.min} attendu.`,
    };
  }
  return { ok: true, value: n };
}
