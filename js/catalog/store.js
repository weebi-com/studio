import { catalogToRows, rowsToCatalog, deleteCalibreFromCatalog } from './rows.js';

export function emptyCatalog() {
  return {
    calibres: [],
    categories: [],
    photos: [],
    warnings: [],
  };
}

export class CatalogStore {
  constructor(initial = emptyCatalog()) {
    this.catalog = {
      calibres: initial.calibres ?? [],
      categories: initial.categories ?? [],
      photos: initial.photos ?? [],
      warnings: initial.warnings ?? [],
    };
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      fn(this.catalog);
    }
  }

  setCatalog(catalog) {
    this.catalog = {
      calibres: catalog.calibres ?? [],
      categories: catalog.categories ?? [],
      photos: catalog.photos ?? [],
      warnings: catalog.warnings ?? [],
    };
    this._emit();
  }

  getRows() {
    return catalogToRows(this.catalog);
  }

  setRows(rows) {
    const next = rowsToCatalog(rows, this.catalog.photos);
    const prev = this.catalog.warnings ?? [];
    const structural = next.warnings ?? [];
    const keptPrev = prev.filter((w) => !String(w).includes('orphelin'));
    next.warnings = [...keptPrev, ...structural];
    this.setCatalog(next);
  }

  deleteCalibre(title) {
    this.setCatalog(deleteCalibreFromCatalog(this.catalog, title));
  }

  upsertPhoto({ calibreTitle, id, data, extension = 'jpeg' }) {
    const title = String(calibreTitle ?? '').trim();
    if (!title || !data) {
      return;
    }
    const photoId = Math.trunc(Number(id) || 0);
    const photos = [...(this.catalog.photos ?? [])].filter(
      (p) => !(p.calibreTitle === title && p.id === photoId),
    );
    photos.push({
      calibreTitle: title,
      id: photoId,
      extension,
      data,
    });
    this.setCatalog({ ...this.catalog, photos });
  }

  clearPhoto(calibreTitle, id) {
    const title = String(calibreTitle ?? '').trim();
    const photoId = Math.trunc(Number(id) || 0);
    this.setCatalog({
      ...this.catalog,
      photos: (this.catalog.photos ?? []).filter(
        (p) => !(p.calibreTitle === title && p.id === photoId),
      ),
    });
  }
}
