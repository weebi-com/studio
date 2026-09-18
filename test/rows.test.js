import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROW_HEADERS,
  ROW_TYPE,
  COL,
  catalogToRows,
  rowsToCatalog,
  deleteCalibreFromCatalog,
  photoStatusForRow,
  photoForRow,
  photoKeyForGridRow,
} from '../js/catalog/rows.js';

describe('catalog rows', () => {
  it('exposes spreadsheet headers', () => {
    assert.deepEqual(ROW_HEADERS, [
      'photo',
      'type',
      'name',
      'lot',
      'price',
      'cost',
      'barcode_ean',
      'category',
      'parent',
    ]);
  });

  it('flattens multi-article calibres as parent + sous-articles', () => {
    const catalog = {
      calibres: [
        {
          title: 'Coca-Cola',
          articles: [
            {
              id: 1,
              designation: 'Coca 33cl',
              price: 500,
              cost: 300,
              barcodeEan: 'A',
              unitsInOnePiece: 1,
            },
            {
              id: 2,
              designation: 'Coca x6',
              price: 2800,
              cost: 1700,
              barcodeEan: 'B',
              unitsInOnePiece: 6,
            },
          ],
        },
      ],
      categories: [
        { title: 'Boissons', color: 4294198070, calibreTitles: ['Coca-Cola'] },
      ],
      photos: [{ calibreTitle: 'Coca-Cola', id: 0, data: [1] }],
      warnings: [],
    };

    const rows = catalogToRows(catalog);
    assert.equal(rows.length, 3);
    assert.equal(rows[0][COL.TYPE], ROW_TYPE.PARENT);
    assert.equal(rows[0][COL.NAME], 'Coca-Cola');
    assert.equal(rows[0][COL.CATEGORY], 'Boissons');
    assert.equal(rows[1][COL.TYPE], ROW_TYPE.SOUS);
    assert.equal(rows[1][COL.NAME], 'Coca 33cl');
    assert.equal(rows[1][COL.LOT], 1);
    assert.equal(rows[1][COL.PARENT], 'Coca-Cola');
    assert.equal(rows[2][COL.NAME], 'Coca x6');
    assert.equal(rows[2][COL.LOT], 6);
  });

  it('maps single-article calibre to Article row', () => {
    const catalog = {
      calibres: [
        {
          title: 'Sucre 1kg',
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
      categories: [],
      photos: [],
    };
    const rows = catalogToRows(catalog);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][COL.TYPE], ROW_TYPE.ARTICLE);
    assert.equal(rows[0][COL.NAME], 'Sucre 1kg');
  });

  it('resolves photo bytes for a row (variant preferred)', () => {
    const photos = [
      { calibreTitle: 'X', id: 0, data: [1] },
      { calibreTitle: 'X', id: 2, data: [2, 2] },
    ];
    assert.equal(photoForRow('X', 1, photos)?.id, 0);
    assert.equal(photoForRow('X', 2, photos)?.id, 2);
    assert.equal(photoForRow('Y', 1, photos), null);
  });

  it('roundtrips type-based rows to nested catalog', () => {
    const rows = [
      ['', ROW_TYPE.PARENT, 'Coca-Cola', '', '', '', '', 'Boissons', ''],
      ['', ROW_TYPE.SOUS, 'Coca 33cl', 1, 500, 300, 'A', 'Boissons', 'Coca-Cola'],
      ['', ROW_TYPE.SOUS, 'Coca x6', 6, 2800, 1700, 'B', 'Boissons', 'Coca-Cola'],
      ['', ROW_TYPE.ARTICLE, 'Sucre 1kg', 1, 100, 80, '', '', ''],
    ];
    const photos = [{ calibreTitle: 'Coca-Cola', id: 0, data: [9] }];
    const catalog = rowsToCatalog(rows, photos);
    assert.equal(catalog.calibres.length, 2);
    const coca = catalog.calibres.find((c) => c.title === 'Coca-Cola');
    assert.equal(coca.articles.length, 2);
    assert.equal(coca.articles[1].unitsInOnePiece, 6);
    assert.equal(catalog.categories[0].title, 'Boissons');
    assert.deepEqual(catalog.categories[0].calibreTitles, ['Coca-Cola']);
    assert.equal(catalog.photos.length, 1);
  });

  it('skips blank names when converting rows', () => {
    const catalog = rowsToCatalog(
      [['', ROW_TYPE.ARTICLE, '', 1, 1, 0, '', '', '']],
      [],
    );
    assert.equal(catalog.calibres.length, 0);
  });

  it('warns and skips orphan sous-articles', () => {
    const catalog = rowsToCatalog(
      [
        ['', ROW_TYPE.SOUS, 'Orphelin', 1, 10, 0, '', '', 'Missing'],
      ],
      [],
    );
    assert.equal(catalog.calibres.length, 0);
    assert.ok(catalog.warnings.some((w) => w.includes('orphelin')));
  });

  it('deletes a calibre and related photos/category links', () => {
    const catalog = {
      calibres: [
        {
          title: 'A',
          articles: [
            {
              id: 1,
              designation: 'A',
              price: 1,
              cost: 0,
              barcodeEan: '',
              unitsInOnePiece: 1,
            },
          ],
        },
        {
          title: 'B',
          articles: [
            {
              id: 1,
              designation: 'B',
              price: 2,
              cost: 0,
              barcodeEan: '',
              unitsInOnePiece: 1,
            },
          ],
        },
      ],
      categories: [{ title: 'Cat', color: 1, calibreTitles: ['A', 'B'] }],
      photos: [
        { calibreTitle: 'A', id: 0, data: [1] },
        { calibreTitle: 'B', id: 0, data: [2] },
      ],
      warnings: [],
    };
    const next = deleteCalibreFromCatalog(catalog, 'A');
    assert.equal(next.calibres.length, 1);
    assert.equal(next.calibres[0].title, 'B');
    assert.deepEqual(next.categories[0].calibreTitles, ['B']);
    assert.equal(next.photos.length, 1);
    assert.equal(next.photos[0].calibreTitle, 'B');
  });

  it('reports photo status for product and row-specific photos', () => {
    const photos = [
      { calibreTitle: 'X', id: 0, data: [1] },
      { calibreTitle: 'X', id: 2, data: [2] },
    ];
    assert.equal(photoStatusForRow('X', 1, photos), 'article');
    assert.equal(photoStatusForRow('X', 2, photos), 'ligne');
    assert.equal(photoStatusForRow('Y', 1, photos), '＋');
  });

  it('builds photo keys for sous-article rows by sibling order', () => {
    const rows = [
      ['', ROW_TYPE.PARENT, 'Coca', '', '', '', '', '', ''],
      ['', ROW_TYPE.SOUS, '33cl', 1, 1, 0, '', '', 'Coca'],
      ['', ROW_TYPE.SOUS, 'x6', 6, 1, 0, '', '', 'Coca'],
    ];
    assert.deepEqual(photoKeyForGridRow(rows[1], rows), {
      calibreTitle: 'Coca',
      articleId: 1,
    });
    assert.deepEqual(photoKeyForGridRow(rows[2], rows), {
      calibreTitle: 'Coca',
      articleId: 2,
    });
  });
});
