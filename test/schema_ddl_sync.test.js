import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_V1_SQL } from '../js/catalog/schema_ddl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

describe('schema_ddl sync', () => {
  it('js SCHEMA_V1_SQL matches schema/v1.sql (ignoring trailing whitespace)', () => {
    const fileSql = readFileSync(join(root, 'schema', 'v1.sql'), 'utf8')
      .replace(/\r\n/g, '\n')
      .trim();
    const jsSql = SCHEMA_V1_SQL.replace(/\r\n/g, '\n').trim();
    assert.equal(jsSql, fileSql);
  });
});
