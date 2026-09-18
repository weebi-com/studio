// Keep in sync with schema/v1.sql — verified by test/schema_ddl_sync.test.js
export const SCHEMA_V1_SQL = `-- Weebi catalog pack schema v1
-- Field names aligned with weebi-com/protos (CalibrePb, ArticleRetailPb, CategoryPb, ArticlePhotoPb)
-- Interchange file extension: .weebi

CREATE TABLE meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE calibres (
  id              INTEGER PRIMARY KEY NOT NULL,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'retail',
  stock_unit      TEXT NOT NULL DEFAULT 'unit',
  status          INTEGER NOT NULL DEFAULT 1,
  creation_date   TEXT,
  update_date     TEXT
);

CREATE TABLE articles (
  calibre_id         INTEGER NOT NULL,
  id                 INTEGER NOT NULL,
  designation        TEXT NOT NULL,
  price              REAL NOT NULL DEFAULT 0,
  cost               REAL NOT NULL DEFAULT 0,
  units_in_one_piece REAL NOT NULL DEFAULT 1,
  barcode_ean        TEXT NOT NULL DEFAULT '',
  status             INTEGER NOT NULL DEFAULT 1,
  creation_date      TEXT,
  PRIMARY KEY (calibre_id, id),
  FOREIGN KEY (calibre_id) REFERENCES calibres(id)
);

CREATE TABLE categories (
  title         TEXT PRIMARY KEY NOT NULL,
  color         INTEGER NOT NULL,
  creation_date TEXT,
  update_date   TEXT
);

CREATE TABLE category_calibres (
  category_title TEXT NOT NULL,
  calibre_id     INTEGER NOT NULL,
  PRIMARY KEY (category_title, calibre_id),
  FOREIGN KEY (category_title) REFERENCES categories(title),
  FOREIGN KEY (calibre_id) REFERENCES calibres(id)
);

CREATE TABLE photos (
  calibre_id INTEGER NOT NULL,
  id         INTEGER NOT NULL,
  extension  TEXT NOT NULL DEFAULT 'jpeg',
  data       BLOB NOT NULL,
  PRIMARY KEY (calibre_id, id),
  FOREIGN KEY (calibre_id) REFERENCES calibres(id)
);

INSERT INTO meta (key, value) VALUES ('schema_version', '1');
INSERT INTO meta (key, value) VALUES ('kind', 'weebi_catalog');
`;
