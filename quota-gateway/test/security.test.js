import { describe, expect, it } from 'vitest';

import { parseContentLength, validateObjectKey } from '../src/security.js';

describe('gateway input validation', () => {
  it('accepts bounded object keys without traversal segments', () => {
    expect(validateObjectKey('screenshots/2026-08-24/a.png')).toEqual({ valid: true });
  });

  it('rejects traversal and malformed percent encoding', () => {
    expect(validateObjectKey('../private.png')).toMatchObject({ valid: false });
    expect(validateObjectKey('%E0%A4%A')).toMatchObject({ valid: false });
  });

  it('requires a positive bounded content length', () => {
    expect(parseContentLength('1048576', 2_000_000)).toEqual({ valid: true, value: 1048576 });
    expect(parseContentLength(null, 2_000_000)).toMatchObject({ valid: false });
    expect(parseContentLength('2000001', 2_000_000)).toMatchObject({ valid: false });
  });
});
