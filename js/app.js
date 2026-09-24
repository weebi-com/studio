import { parseCatalogCsv } from './catalog/parse_csv.js';
import { parseWeebiArticlesJson } from './catalog/parse_weebi_json.js';
import { exportWeebiBytes } from './catalog/export_weebi.js';
import { importWeebiBytes } from './catalog/import_weebi.js';
import { CatalogStore } from './catalog/store.js';
import { resizeImageToJpeg } from './catalog/photo.js';
import {
  NUMERIC_COLUMN_RULES,
  validateNumericCell,
} from './catalog/validators.js';
import {
  COL,
  ROW_TYPE,
  photoForRow,
  photoKeyForGridRow,
  sellFieldsEditable,
  categoryEditable,
} from './catalog/rows.js';

const store = new CatalogStore();
let worksheet = null;
let syncingFromStore = false;
/** @type {{ rowIndex: number, previousType: string }|null} */
let pendingTypeChange = null;

/** @type {Map<string, { url: string, fp: string }>} */
const photoDataUrlCache = new Map();

const EMPTY_PHOTO_DATA_URL =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">' +
      '<rect width="44" height="44" rx="6" fill="#e8f1fb" stroke="#93c5fd"/>' +
      '<text x="22" y="29" text-anchor="middle" font-size="22" fill="#135397">+</text>' +
      '</svg>',
  );

const weebiInput = document.getElementById('weebiInput');
const jsonInput = document.getElementById('jsonInput');
const csvInput = document.getElementById('csvInput');
const exportBtn = document.getElementById('exportBtn');
const exportError = document.getElementById('exportError');
const photoInput = document.getElementById('photoInput');
const warningsEl = document.getElementById('warnings');
const warningsBanner = document.getElementById('warningsBanner');
const warningsToggle = document.getElementById('warningsToggle');
const warningsSummary = document.getElementById('warningsSummary');
const status = document.getElementById('status');
const sheetEl = document.getElementById('spreadsheet');
const sousDialog = document.getElementById('sousProduitDialog');
const sousForm = document.getElementById('sousProduitForm');
const sousParentSelect = document.getElementById('sousParentSelect');
const sousLotInput = document.getElementById('sousLotInput');

const MIN_GRID_ROWS = 80;
/** Right-click insert adds a batch; empty rows are skipped on export. */
const INSERT_ROW_BATCH = 10;
const PHOTO_COL = COL.PHOTO;
const PHOTO_THUMB_PX = 44;
const TYPE_SOURCE = [
  ROW_TYPE.ARTICLE,
  ROW_TYPE.PARENT,
  ROW_TYPE.SOUS,
];

/** @type {number|null} */
let pendingPhotoRow = null;

function photoFingerprint(data) {
  if (!data) {
    return '';
  }
  const len = data.byteLength ?? data.length ?? 0;
  const a = data[0] ?? 0;
  const b = data[Math.min(16, len - 1)] ?? 0;
  const c = data[Math.max(0, len - 1)] ?? 0;
  return `${len}:${a}:${b}:${c}`;
}

function bytesToDataUrl(data, extension = 'jpeg') {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const mime = extension === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${btoa(binary)}`;
}

function dataUrlForPhoto(photo) {
  const key = `${photo.calibreTitle}|${photo.id}`;
  const fp = photoFingerprint(photo.data);
  const cached = photoDataUrlCache.get(key);
  if (cached && cached.fp === fp) {
    return cached.url;
  }
  const url = bytesToDataUrl(photo.data, photo.extension ?? 'jpeg');
  photoDataUrlCache.set(key, { url, fp });
  return url;
}

function photoCellValue(row, allRows) {
  const key = photoKeyForGridRow(row, allRows);
  if (!key.calibreTitle) {
    return EMPTY_PHOTO_DATA_URL;
  }
  const photo = photoForRow(
    key.calibreTitle,
    key.articleId,
    store.catalog.photos,
  );
  if (!photo?.data) {
    return EMPTY_PHOTO_DATA_URL;
  }
  return dataUrlForPhoto(photo);
}

function emptyRow() {
  return [
    EMPTY_PHOTO_DATA_URL,
    ROW_TYPE.ARTICLE,
    '',
    1,
    0,
    0,
    '',
    '',
    '',
  ];
}

function padRows(rows) {
  const next = rows.length > 0 ? [...rows] : [emptyRow()];
  while (next.length < MIN_GRID_ROWS) {
    next.push(emptyRow());
  }
  return next;
}

function neatNum(value) {
  if (value === '' || value == null) {
    return value;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return value;
  }
  return Number.isInteger(n) ? Math.trunc(n) : n;
}

function rowsForGrid(rows) {
  const padded = padRows(rows);
  return padded.map((row) => {
    const next = [...row];
    while (next.length < 9) {
      next.push('');
    }
    next[COL.PHOTO] = photoCellValue(next, padded);
    if (!next[COL.TYPE]) {
      next[COL.TYPE] = ROW_TYPE.ARTICLE;
    }
    next[COL.LOT] = neatNum(next[COL.LOT]);
    next[COL.PRICE] = neatNum(next[COL.PRICE]);
    next[COL.COST] = neatNum(next[COL.COST]);
    return next;
  });
}

function inheritCategoryFromParent(parentName, allRows) {
  const parent = String(parentName ?? '').trim();
  for (const r of allRows) {
    if (
      String(r[COL.TYPE] ?? '') === ROW_TYPE.PARENT &&
      String(r[COL.NAME] ?? '').trim() === parent
    ) {
      return String(r[COL.CATEGORY] ?? '').trim();
    }
  }
  return '';
}

function syncSousCategories(data) {
  for (const row of data) {
    if (String(row[COL.TYPE] ?? '') !== ROW_TYPE.SOUS) {
      continue;
    }
    row[COL.CATEGORY] = inheritCategoryFromParent(row[COL.PARENT], data);
  }
}

const NAME_COL_MIN_WIDTH = 180;
/** jspreadsheet row-index col width (see create colgroup). */
const ROW_INDEX_COL_WIDTH = 50;
/** Scrollbar + content padding so the table does not overflow horizontally. */
const SHEET_WIDTH_GUTTER = 24;

const COLUMNS = [
  {
    type: 'image',
    title: 'Photo',
    width: 72,
    readOnly: true,
    align: 'center',
  },
  {
    type: 'dropdown',
    title: 'Type',
    width: 130,
    source: TYPE_SOURCE,
  },
  { type: 'text', title: 'Article / Libellé', width: NAME_COL_MIN_WIDTH },
  {
    type: 'numeric',
    title: 'Vendu par lots de',
    width: 130,
  },
  { type: 'numeric', title: 'Prix', width: 80 },
  { type: 'numeric', title: 'Coût', width: 80 },
  { type: 'text', title: 'Code-barres', width: 140 },
  { type: 'text', title: 'Catégorie', width: 120 },
  {
    type: 'text',
    title: 'Parent',
    width: 140,
    readOnly: true,
    tooltip: 'Renseigné uniquement pour les sous-articles (via le dialogue de liaison).',
  },
];

const FIXED_COLS_WIDTH = COLUMNS.reduce(
  (sum, col, i) => (i === COL.NAME ? sum : sum + Number(col.width || 100)),
  0,
);

function sheetTableHeight() {
  const h = sheetEl.clientHeight;
  return h > 120 ? `${h}px` : '70vh';
}

function nameColumnWidthForViewport() {
  const available = sheetEl.clientWidth;
  if (available <= 0) {
    return NAME_COL_MIN_WIDTH;
  }
  return Math.max(
    NAME_COL_MIN_WIDTH,
    available - FIXED_COLS_WIDTH - ROW_INDEX_COL_WIDTH - SHEET_WIDTH_GUTTER,
  );
}

function setWarnings(list) {
  const items = list && list.length > 0 ? list : [];
  if (items.length === 0) {
    warningsBanner.hidden = true;
    warningsBanner.classList.remove('is-open');
    warningsEl.hidden = true;
    warningsToggle.setAttribute('aria-expanded', 'false');
    warningsEl.textContent = '';
    warningsSummary.textContent = 'Avertissements';
    return;
  }
  warningsBanner.hidden = false;
  warningsEl.textContent = items.join('\n');
  const n = items.length;
  warningsSummary.textContent =
    n === 1 ? '1 avertissement' : `${n} avertissements`;
}

function toggleWarningsDetail() {
  const open = warningsBanner.classList.toggle('is-open');
  warningsEl.hidden = !open;
  warningsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setExportError(msg) {
  if (!msg) {
    exportError.hidden = true;
    exportError.textContent = '';
    return;
  }
  exportError.textContent = msg;
  exportError.hidden = false;
}

let statusClearTimer = null;

function setStatus(msg, options = {}) {
  const text = String(msg ?? '').trim();
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  if (!text) {
    status.textContent = '';
    status.hidden = true;
    status.classList.remove('is-alert');
    return;
  }
  status.textContent = text;
  status.hidden = false;
  status.classList.toggle('is-alert', Boolean(options.alert));
  if (options.alert) {
    statusClearTimer = setTimeout(() => {
      if (status.classList.contains('is-alert')) {
        setStatus('');
      }
    }, 4000);
  }
}

function pushGridToStore() {
  if (!worksheet || syncingFromStore) {
    return;
  }
  const data = worksheet.getData();
  syncSousCategories(data);
  store.setRows(data);
}

function applyRowStyles() {
  if (!worksheet) {
    return;
  }
  const data =
    typeof worksheet.getData === 'function' ? worksheet.getData() : [];
  for (let y = 0; y < data.length; y += 1) {
    const type = String(data[y]?.[COL.TYPE] ?? ROW_TYPE.ARTICLE);
    let tr = null;
    const cell0 =
      typeof worksheet.getCellFromCoords === 'function'
        ? worksheet.getCellFromCoords(0, y)
        : worksheet.records?.[y]?.[0]?.element;
    if (cell0?.parentElement) {
      tr = cell0.parentElement;
    }
    if (!tr) {
      continue;
    }
    tr.classList.remove(
      'row-type-article',
      'row-type-parent',
      'row-type-sous',
    );
    if (type === ROW_TYPE.PARENT) {
      tr.classList.add('row-type-parent');
    } else if (type === ROW_TYPE.SOUS) {
      tr.classList.add('row-type-sous');
    } else {
      tr.classList.add('row-type-article');
    }

    const sellOk = sellFieldsEditable(type);
    const catOk = categoryEditable(type);
    for (const col of [COL.LOT, COL.PRICE, COL.COST, COL.BARCODE]) {
      const td =
        typeof worksheet.getCellFromCoords === 'function'
          ? worksheet.getCellFromCoords(col, y)
          : null;
      if (td) {
        td.classList.toggle('cell-disabled', !sellOk);
      }
    }
    const catTd =
      typeof worksheet.getCellFromCoords === 'function'
        ? worksheet.getCellFromCoords(COL.CATEGORY, y)
        : null;
    if (catTd) {
      catTd.classList.toggle('cell-disabled', !catOk);
    }
    // Parent is only meaningful for sous-articles: leave other rows blank
    // (no grey hatch) and lightly mark the linked value on sous rows.
    const parentTd =
      typeof worksheet.getCellFromCoords === 'function'
        ? worksheet.getCellFromCoords(COL.PARENT, y)
        : null;
    if (parentTd) {
      parentTd.classList.remove('cell-disabled');
      parentTd.classList.toggle('cell-parent-link', type === ROW_TYPE.SOUS);
    }
  }
}

function loadGridFromStore() {
  if (!worksheet) {
    return;
  }
  syncingFromStore = true;
  try {
    worksheet.setData(rowsForGrid(store.getRows()));
  } finally {
    syncingFromStore = false;
  }
  requestAnimationFrame(applyRowStyles);
  setWarnings(store.catalog.warnings);
}

function previousCellValue(instance, colIndex, rowIndex) {
  const x = Number(colIndex);
  const y = Number(rowIndex);
  if (typeof instance?.getValueFromCoords === 'function') {
    return instance.getValueFromCoords(x, y);
  }
  return instance?.options?.data?.[y]?.[x];
}

function applySheetHeight() {
  if (!worksheet) {
    return;
  }
  const h = sheetTableHeight();
  if (worksheet.options) {
    worksheet.options.tableHeight = h;
  }
  const content =
    worksheet.content ||
    sheetEl.querySelector('.jss_content') ||
    sheetEl.querySelector('.jexcel_content');
  if (content) {
    content.style.height = h;
    content.style.maxHeight = h;
  }
}

/**
 * Stretch "Article / Libellé" so the grid fills the viewport width.
 * Updates the colgroup directly to avoid polluting jspreadsheet undo history.
 */
function applyNameColumnWidth() {
  if (!worksheet?.cols?.[COL.NAME]?.colElement) {
    return;
  }
  const width = nameColumnWidthForViewport();
  const colEl = worksheet.cols[COL.NAME].colElement;
  if (String(colEl.getAttribute('width')) === String(width)) {
    return;
  }
  colEl.setAttribute('width', String(width));
  if (worksheet.options?.columns?.[COL.NAME]) {
    worksheet.options.columns[COL.NAME].width = width;
  }
  if (COLUMNS[COL.NAME]) {
    COLUMNS[COL.NAME].width = width;
  }
}

function applySheetLayout() {
  applySheetHeight();
  applyNameColumnWidth();
}

function listParentNames(data) {
  /** @type {string[]} */
  const names = [];
  const seen = new Set();
  for (const row of data) {
    if (String(row[COL.TYPE] ?? '') !== ROW_TYPE.PARENT) {
      continue;
    }
    const name = String(row[COL.NAME] ?? '').trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

function openSousProduitDialog(rowIndex, previousType) {
  const data = worksheet.getData();
  const parents = listParentNames(data);
  if (parents.length === 0) {
    setStatus(
      'Créez d’abord une ligne « Article parent » avant un sous-article.',
    );
    syncingFromStore = true;
    try {
      if (typeof worksheet.setValueFromCoords === 'function') {
        worksheet.setValueFromCoords(COL.TYPE, rowIndex, previousType, true);
      }
    } finally {
      syncingFromStore = false;
    }
    return;
  }
  sousParentSelect.replaceChildren();
  for (const name of parents) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sousParentSelect.appendChild(opt);
  }
  sousLotInput.value = '1';
  pendingTypeChange = { rowIndex, previousType };
  if (typeof sousDialog.showModal === 'function') {
    sousDialog.showModal();
  } else {
    sousDialog.setAttribute('open', '');
  }
}

function closeSousDialog() {
  if (typeof sousDialog.close === 'function') {
    sousDialog.close();
  } else {
    sousDialog.removeAttribute('open');
  }
}

function applyParentConversion(rowIndex) {
  syncingFromStore = true;
  try {
    if (typeof worksheet.setValueFromCoords === 'function') {
      worksheet.setValueFromCoords(COL.LOT, rowIndex, '', true);
      worksheet.setValueFromCoords(COL.PRICE, rowIndex, '', true);
      worksheet.setValueFromCoords(COL.COST, rowIndex, '', true);
      worksheet.setValueFromCoords(COL.BARCODE, rowIndex, '', true);
      worksheet.setValueFromCoords(COL.PARENT, rowIndex, '', true);
    }
  } finally {
    syncingFromStore = false;
  }
}

function handleTypeChange(rowIndex, newType, previousType) {
  if (newType === previousType) {
    return;
  }
  if (newType === ROW_TYPE.SOUS) {
    openSousProduitDialog(rowIndex, previousType);
    return;
  }
  if (previousType === ROW_TYPE.SOUS) {
    const ok = window.confirm(
      'Détacher ce sous-article de l’article parent ? Cette action a des conséquences sur le regroupement.',
    );
    if (!ok) {
      syncingFromStore = true;
      try {
        worksheet.setValueFromCoords(COL.TYPE, rowIndex, previousType, true);
      } finally {
        syncingFromStore = false;
      }
      return;
    }
    syncingFromStore = true;
    try {
      worksheet.setValueFromCoords(COL.PARENT, rowIndex, '', true);
      if (newType === ROW_TYPE.ARTICLE) {
        const lot = worksheet.getValueFromCoords(COL.LOT, rowIndex);
        if (lot === '' || lot == null) {
          worksheet.setValueFromCoords(COL.LOT, rowIndex, 1, true);
        }
      }
    } finally {
      syncingFromStore = false;
    }
  }
  if (newType === ROW_TYPE.PARENT) {
    applyParentConversion(rowIndex);
  }
  applyRowStyles();
}

sousForm.addEventListener('submit', (e) => {
  const submitter = e.submitter;
  const value = submitter?.value ?? 'cancel';
  e.preventDefault();
  const pending = pendingTypeChange;
  pendingTypeChange = null;
  closeSousDialog();
  if (!pending || !worksheet) {
    return;
  }
  const { rowIndex, previousType } = pending;
  if (value !== 'ok') {
    syncingFromStore = true;
    try {
      worksheet.setValueFromCoords(COL.TYPE, rowIndex, previousType, true);
    } finally {
      syncingFromStore = false;
    }
    applyRowStyles();
    return;
  }
  const parent = sousParentSelect.value;
  const lot = Number(sousLotInput.value);
  if (!parent || !(lot > 0)) {
    syncingFromStore = true;
    try {
      worksheet.setValueFromCoords(COL.TYPE, rowIndex, previousType, true);
    } finally {
      syncingFromStore = false;
    }
    setStatus('Parent ou lot invalide.');
    applyRowStyles();
    return;
  }
  const data = worksheet.getData();
  const category = inheritCategoryFromParent(parent, data);
  syncingFromStore = true;
  try {
    worksheet.setValueFromCoords(COL.TYPE, rowIndex, ROW_TYPE.SOUS, true);
    worksheet.setValueFromCoords(COL.PARENT, rowIndex, parent, true);
    worksheet.setValueFromCoords(COL.LOT, rowIndex, lot, true);
    worksheet.setValueFromCoords(COL.CATEGORY, rowIndex, category, true);
  } finally {
    syncingFromStore = false;
  }
  applyRowStyles();
  setStatus(`Sous-article lié à « ${parent} » (lots de ${lot}).`);
});

/**
 * Replace default single-row insert actions with a batch of empty rows.
 * @param {object} worksheet
 * @param {unknown} _x
 * @param {unknown} y
 * @param {Event} _e
 * @param {Array<{ title?: string, onclick?: Function, type?: string }>} items
 */
function customizeContextMenu(worksheet, _x, y, _e, items) {
  const rowIndex = Number.parseInt(String(y), 10);
  if (!Number.isFinite(rowIndex) || !Array.isArray(items)) {
    return items;
  }
  return items.map((item) => {
    const title = String(item?.title ?? '').toLowerCase();
    if (title.includes('row before') || title.includes('ligne avant')) {
      return {
        title: `Insérer ${INSERT_ROW_BATCH} lignes avant`,
        onclick: () => worksheet.insertRow(INSERT_ROW_BATCH, rowIndex, 1),
      };
    }
    if (
      title.includes('row after') ||
      title.includes('ligne après') ||
      title.includes('ligne apres')
    ) {
      return {
        title: `Insérer ${INSERT_ROW_BATCH} lignes après`,
        onclick: () => worksheet.insertRow(INSERT_ROW_BATCH, rowIndex),
      };
    }
    return item;
  });
}

function initSpreadsheet() {
  const jspreadsheet = window.jspreadsheet;
  if (typeof jspreadsheet !== 'function') {
    setStatus('Erreur: jspreadsheet non chargé.');
    return;
  }
  COLUMNS[COL.NAME].width = nameColumnWidthForViewport();
  const instances = jspreadsheet(sheetEl, {
    worksheets: [
      {
        data: rowsForGrid([]),
        columns: COLUMNS,
        minDimensions: [9, MIN_GRID_ROWS],
        tableOverflow: true,
        tableWidth: '100%',
        tableHeight: sheetTableHeight(),
        columnSorting: false,
        defaultRowHeight: PHOTO_THUMB_PX + 12,
        allowInsertRow: true,
        allowManualInsertRow: true,
        allowDeleteRow: true,
      },
    ],
    contextMenu: customizeContextMenu,
    onbeforechange(instance, _cell, colIndex, rowIndex, newValue) {
      if (syncingFromStore) {
        return newValue;
      }
      const col = Number(colIndex);
      const row = instance?.options?.data?.[rowIndex] ?? [];
      const type = String(row[COL.TYPE] ?? ROW_TYPE.ARTICLE);

      if (col === COL.PARENT) {
        return previousCellValue(instance, colIndex, rowIndex);
      }
      if (
        (col === COL.LOT ||
          col === COL.PRICE ||
          col === COL.COST ||
          col === COL.BARCODE) &&
        !sellFieldsEditable(type)
      ) {
        setStatus('Champ non éditable pour un article parent.', { alert: true });
        return previousCellValue(instance, colIndex, rowIndex);
      }
      if (col === COL.CATEGORY && !categoryEditable(type)) {
        setStatus('Catégorie héritée de l’article parent.', { alert: true });
        return previousCellValue(instance, colIndex, rowIndex);
      }
      if (col in NUMERIC_COLUMN_RULES) {
        if (
          type === ROW_TYPE.PARENT &&
          (col === COL.LOT || col === COL.PRICE || col === COL.COST)
        ) {
          return newValue === '' || newValue == null
            ? newValue
            : previousCellValue(instance, colIndex, rowIndex);
        }
        if (newValue === '' || newValue == null) {
          if (col === COL.LOT && type === ROW_TYPE.PARENT) {
            return '';
          }
        }
        const result = validateNumericCell(colIndex, newValue);
        if (!result.ok) {
          setStatus(result.message);
          return previousCellValue(instance, colIndex, rowIndex);
        }
        return neatNum(result.value);
      }
      return newValue;
    },
    onchange(instance, _cell, colIndex, rowIndex, newValue, oldValue) {
      if (syncingFromStore) {
        return;
      }
      if (Number(colIndex) === COL.TYPE) {
        handleTypeChange(
          Number(rowIndex),
          String(newValue ?? ''),
          String(oldValue ?? ROW_TYPE.ARTICLE),
        );
        return;
      }
      if (Number(colIndex) === COL.NAME && String(instance?.options?.data?.[rowIndex]?.[COL.TYPE]) === ROW_TYPE.PARENT) {
        // refresh inherited categories on children after parent rename is complex; push on next sync
      }
      applyRowStyles();
    },
    onselection(_instance, x1, y1, x2, y2, origin) {
      if (syncingFromStore || !photoInput) {
        return;
      }
      if (Number(x1) !== PHOTO_COL || Number(x2) !== PHOTO_COL) {
        return;
      }
      if (Number(y1) !== Number(y2)) {
        return;
      }
      const fromMouse =
        origin &&
        typeof origin.type === 'string' &&
        (origin.type === 'mousedown' ||
          origin.type === 'mouseup' ||
          origin.type === 'click' ||
          origin.type === 'pointerdown');
      if (!fromMouse) {
        return;
      }
      pendingPhotoRow = Number(y1);
      photoInput.click();
    },
  });
  worksheet = Array.isArray(instances) ? instances[0] : instances;
  requestAnimationFrame(() => {
    applySheetLayout();
    applyRowStyles();
  });
  window.addEventListener('resize', applySheetLayout);
}

function applyLoadedCatalog(catalog, label) {
  store.setCatalog(catalog);
  loadGridFromStore();
  setExportError('');
  const nArt = catalog.calibres.reduce(
    (n, c) => n + (c.articles?.length ?? 0),
    0,
  );
  setStatus(
    `${label} : ${catalog.calibres.length} calibre(s), ${nArt} article(s).`,
  );
}

weebiInput.addEventListener('change', async () => {
  const file = weebiInput.files?.[0];
  if (!file) {
    return;
  }
  setStatus('Lecture .db…');
  try {
    const buffer = await file.arrayBuffer();
    const catalog = await importWeebiBytes(new Uint8Array(buffer), {
      locateFile: (f) => `./node_modules/sql.js/dist/${f}`,
    });
    applyLoadedCatalog(catalog, 'Pack .db');
  } catch (e) {
    console.error(e);
    setStatus(`Erreur .db: ${e}`);
  }
  weebiInput.value = '';
});

jsonInput.addEventListener('change', async () => {
  const file = jsonInput.files?.[0];
  if (!file) {
    return;
  }
  setStatus('Lecture JSON…');
  try {
    const text = await file.text();
    applyLoadedCatalog(parseWeebiArticlesJson(text), 'JSON');
  } catch (e) {
    console.error(e);
    setStatus(`Erreur JSON: ${e}`);
  }
  jsonInput.value = '';
});

csvInput.addEventListener('change', async () => {
  const file = csvInput.files?.[0];
  if (!file) {
    return;
  }
  setStatus('Lecture CSV…');
  try {
    const text = await file.text();
    applyLoadedCatalog(parseCatalogCsv(text), 'CSV');
  } catch (e) {
    console.error(e);
    setStatus(`Erreur CSV: ${e}`);
  }
  csvInput.value = '';
});

warningsToggle.addEventListener('click', toggleWarningsDetail);

async function attachPhoto(file, rowIndex) {
  pushGridToStore();
  const data =
    worksheet && typeof worksheet.getData === 'function'
      ? worksheet.getData()
      : padRows(store.getRows());
  const idx = Math.trunc(Number(rowIndex));
  const row = Number.isFinite(idx) && idx >= 0 ? data[idx] : null;
  if (!row) {
    setStatus('Sélectionnez une ligne dans le tableau.');
    return;
  }
  const key = photoKeyForGridRow(row, data);
  if (!key.calibreTitle) {
    setStatus(
      'Indiquez le nom (et le parent pour un sous-article) avant la photo.',
    );
    return;
  }
  setStatus('Redimensionnement photo…');
  try {
    const { data: bytes, extension } = await resizeImageToJpeg(file);
    store.upsertPhoto({
      calibreTitle: key.calibreTitle,
      id: key.articleId,
      data: bytes,
      extension,
    });
    loadGridFromStore();
    setStatus(`Photo jointe pour « ${key.calibreTitle} ».`);
  } catch (e) {
    console.error(e);
    setStatus(`Erreur photo: ${e}`);
  }
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files?.[0];
  const rowIndex = pendingPhotoRow;
  pendingPhotoRow = null;
  photoInput.value = '';
  if (file && rowIndex != null) {
    await attachPhoto(file, rowIndex);
  }
});

exportBtn.addEventListener('click', async () => {
  pushGridToStore();
  const catalog = store.catalog;
  if (!catalog.calibres.length) {
    setExportError(
      'Catalogue vide — chargez un fichier ou saisissez un article.',
    );
    return;
  }
  setExportError('');
  setStatus('Export .db…');
  try {
    const bytes = await exportWeebiBytes(catalog, {
      locateFile: (file) => `./node_modules/sql.js/dist/${file}`,
    });
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalogue.db';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Fichier catalogue.db téléchargé.');
  } catch (e) {
    console.error(e);
    setExportError(`Erreur export: ${e}`);
  }
});

store.subscribe(() => {
  setWarnings(store.catalog.warnings);
});

initSpreadsheet();
setStatus('Chargez un fichier, ou saisissez un article dans le tableau.');
