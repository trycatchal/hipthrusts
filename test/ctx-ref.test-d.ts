// Type-level tests for the backend-neutral ctxRef marker primitives.
import { describe, expectTypeOf, it } from 'vitest';
import type { CtxRef, CtxRefReq, SpecReq } from '../src/ctx-ref.js';
import { ctxRef } from '../src/ctx-ref.js';

describe('CtxRef / ctxRef', () => {
  it('ctxRef carries its path as a literal type', () => {
    expectTypeOf(ctxRef('inputs.body.user')).toEqualTypeOf<
      CtxRef<'inputs.body.user'>
    >();
  });
});

describe('CtxRefReq', () => {
  it('derives a nested requirement from a dot path', () => {
    expectTypeOf<CtxRefReq<'inputs.body.user'>>().toEqualTypeOf<{
      inputs: { body: { user: unknown } };
    }>();
  });
});

describe('SpecReq (spec-requirement mapper)', () => {
  it('combines every ctxRef path into one nested requirement; literals add nothing', () => {
    type Req = SpecReq<{
      _id: CtxRef<'inputs.body.user'>;
      status: { $in: string[] }; // literal — contributes no requirement
      org: CtxRef<'inputs.params.orgId'>;
    }>;
    expectTypeOf<Req>().toMatchTypeOf<{
      inputs: { body: { user: unknown }; params: { orgId: unknown } };
    }>();
  });

  it('a spec with no ctxRefs requires nothing', () => {
    // No ctxRefs => no required keys (the `{}` empty requirement).
    expectTypeOf<keyof SpecReq<{ status: string }>>().toEqualTypeOf<never>();
  });
});
