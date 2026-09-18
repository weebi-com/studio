import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNumericCell } from '../js/catalog/validators.js';

describe('validateNumericCell', () => {
  it('requires Vendu par lots de > 0', () => {
    assert.deepEqual(validateNumericCell(3, '1'), { ok: true, value: 1 });
    assert.deepEqual(validateNumericCell(3, '6'), { ok: true, value: 6 });
    assert.equal(validateNumericCell(3, '0').ok, false);
    assert.equal(validateNumericCell(3, 'abc').ok, false);
  });

  it('accepts decimals for Prix / Coût (comma or dot)', () => {
    assert.deepEqual(validateNumericCell(4, '12,5'), { ok: true, value: 12.5 });
    assert.deepEqual(validateNumericCell(5, '0'), { ok: true, value: 0 });
    assert.deepEqual(validateNumericCell(4, '100.25'), {
      ok: true,
      value: 100.25,
    });
  });

  it('rejects text and negatives for Prix / Coût', () => {
    assert.equal(validateNumericCell(4, 'dix').ok, false);
    assert.equal(validateNumericCell(5, '-1').ok, false);
    assert.equal(validateNumericCell(4, '12a').ok, false);
  });

  it('passes through non-numeric columns', () => {
    assert.deepEqual(validateNumericCell(2, 'titre'), {
      ok: true,
      value: 'titre',
    });
  });
});
