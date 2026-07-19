import { describe, expect, it } from 'vitest';
import { ctxRef, isCtxRef } from '../src/ctx-ref';

describe('ctxRef marker', () => {
  it('ctxRef mints a marker carrying its path', () => {
    const ref = ctxRef('inputs.body.user');
    expect(ref.path).toBe('inputs.body.user');
    expect(isCtxRef(ref)).toBe(true);
  });

  it('isCtxRef narrows a marker and rejects everything else', () => {
    const ref = ctxRef('inputs.params.id');
    expect(isCtxRef(ref)).toBe(true);
    if (isCtxRef(ref)) {
      // narrows to CtxRef — .path is readable without a cast
      expect(ref.path).toBe('inputs.params.id');
    }
    for (const notARef of [
      null,
      undefined,
      {},
      { path: 'inputs.body.user' }, // a path but no marker symbol
      'inputs.body.user',
      42,
    ]) {
      expect(isCtxRef(notARef)).toBe(false);
    }
  });

  it('isCtxRef matches a marker minted from the shared Symbol.for registry', () => {
    // An alternative-backend loader that never imported ctxRef but stamps the
    // same registered symbol is still recognized — the point of the shared
    // registry, and why isCtxRef is exported for reuse.
    const foreign = {
      [Symbol.for('hipthrusts.ctxRef')]: true,
      path: 'inputs.params.id',
    };
    expect(isCtxRef(foreign)).toBe(true);
  });
});
