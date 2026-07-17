import { describe, expect, it, vi } from 'vitest';
import { HTPipe } from '../src';
import { executeHipthrustable, withDefaultImplementations } from '../src/core';
import { HipForbidden } from '../src/errors';
import { toExpressHandler } from '../src/express';

// Runtime regression tests for issue #111: composed authorizers must preserve
// the left fragment's returned context (originally reported as #37). The
// merge is type-level tested in composition.test-d.ts; these lock the runtime
// behavior so a regression can't slip through type-checking.

const emptyRawRequest = { params: {}, query: {}, body: {}, headers: {} };

function runnable(fragments: Record<string, any>) {
  return withDefaultImplementations({
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: () => ({ ok: true }),
    redactResponse: (u: any) => u,
    ...fragments,
  } as any);
}

describe('composed preAuthorize preserves left-returned context', () => {
  it('left object + right true: left keys reach downstream stages', async () => {
    const piped = HTPipe(
      { preAuthorize: () => ({ role: 'admin' }) },
      { preAuthorize: () => true }
    );
    let executeCtx: any;
    const handler = runnable({
      ...piped,
      execute: (ctx: any) => {
        executeCtx = ctx;
        return { ok: true };
      },
    });
    await executeHipthrustable(handler, emptyRawRequest);
    expect(executeCtx.role).toBe('admin');
  });

  it('left true + right object: right keys reach downstream stages', async () => {
    const piped = HTPipe(
      { preAuthorize: () => true },
      { preAuthorize: () => ({ tier: 'gold' }) }
    );
    let executeCtx: any;
    const handler = runnable({
      ...piped,
      execute: (ctx: any) => {
        executeCtx = ctx;
        return { ok: true };
      },
    });
    await executeHipthrustable(handler, emptyRawRequest);
    expect(executeCtx.tier).toBe('gold');
  });

  it('both objects: merged with right-wins on collisions', () => {
    const piped = HTPipe(
      { preAuthorize: () => ({ role: 'admin', tier: 1 }) },
      { preAuthorize: () => ({ tier: 2 }) }
    );
    expect((piped as any).preAuthorize({})).toEqual({ role: 'admin', tier: 2 });
  });

  it('the right authorizer receives the left-returned keys in its input', () => {
    let rightSaw: any;
    const piped = HTPipe(
      { preAuthorize: () => ({ role: 'admin' }) },
      {
        preAuthorize: (ctx: any) => {
          rightSaw = ctx.role;
          return true;
        },
      }
    );
    (piped as any).preAuthorize({});
    expect(rightSaw).toBe('admin');
  });

  it('left false short-circuits: right never runs and the request is forbidden', async () => {
    const rightSpy = vi.fn(() => true);
    const piped = HTPipe(
      { preAuthorize: () => false as const },
      { preAuthorize: rightSpy }
    );
    const handler = runnable({ ...piped });
    await expect(
      executeHipthrustable(handler, emptyRawRequest)
    ).rejects.toBeInstanceOf(HipForbidden);
    expect(rightSpy).not.toHaveBeenCalled();
  });
});

describe('composed finalAuthorize preserves left-returned context', () => {
  it('left object + right true: left keys reach execute', async () => {
    const piped = HTPipe(
      { finalAuthorize: () => ({ ownerChecked: true }) },
      { finalAuthorize: () => true }
    );
    let executeCtx: any;
    const handler = runnable({
      ...piped,
      execute: (ctx: any) => {
        executeCtx = ctx;
        return { ok: true };
      },
    });
    await executeHipthrustable(handler, emptyRawRequest);
    expect(executeCtx.ownerChecked).toBe(true);
  });

  it('left true + right object: right keys reach execute', async () => {
    const piped = HTPipe(
      { finalAuthorize: () => true },
      { finalAuthorize: () => ({ audit: 'pass' }) }
    );
    let executeCtx: any;
    const handler = runnable({
      ...piped,
      execute: (ctx: any) => {
        executeCtx = ctx;
        return { ok: true };
      },
    });
    await executeHipthrustable(handler, emptyRawRequest);
    expect(executeCtx.audit).toBe('pass');
  });

  it('both objects: merged with right-wins on collisions', async () => {
    const piped = HTPipe(
      { finalAuthorize: () => ({ scope: 'own', level: 1 }) },
      { finalAuthorize: () => ({ level: 2 }) }
    );
    await expect((piped as any).finalAuthorize({})).resolves.toEqual({
      scope: 'own',
      level: 2,
    });
  });

  it('the right authorizer receives the left-returned keys (async left)', async () => {
    let rightSaw: any;
    const piped = HTPipe(
      { finalAuthorize: async () => ({ doc: { ownerId: 'u1' } }) },
      {
        finalAuthorize: (ctx: any) => {
          rightSaw = ctx.doc;
          return true;
        },
      }
    );
    await (piped as any).finalAuthorize({});
    expect(rightSaw).toEqual({ ownerId: 'u1' });
  });

  it('left false short-circuits: right never runs and the request is forbidden', async () => {
    const rightSpy = vi.fn(() => true);
    const piped = HTPipe(
      { finalAuthorize: () => false as const },
      { finalAuthorize: rightSpy }
    );
    const handler = runnable({ ...piped });
    await expect(
      executeHipthrustable(handler, emptyRawRequest)
    ).rejects.toBeInstanceOf(HipForbidden);
    expect(rightSpy).not.toHaveBeenCalled();
  });
});

describe('composition arity edges (runtime)', () => {
  it('a single-fragment pipe passes authorizer context through unchanged', async () => {
    const piped = HTPipe({ preAuthorize: () => ({ solo: true }) });
    let executeCtx: any;
    const handler = runnable({
      ...piped,
      execute: (ctx: any) => {
        executeCtx = ctx;
        return { ok: true };
      },
    });
    await executeHipthrustable(handler, emptyRawRequest);
    expect(executeCtx.solo).toBe(true);
  });

  it('a four-fragment authorizer pipe accumulates context left to right', () => {
    const piped = HTPipe(
      { preAuthorize: () => ({ a: 1 }) },
      { preAuthorize: () => true },
      { preAuthorize: (ctx: any) => ({ b: ctx.a + 1 }) },
      { preAuthorize: () => ({ c: 3 }) }
    );
    expect((piped as any).preAuthorize({})).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe('end-to-end: piped pre+final authorizer chain through the express adapter', () => {
  function fakeRes(): any {
    return {
      statusCode: 200,
      body: undefined as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(b: any) {
        this.body = b;
      },
      setHeader() {},
    };
  }

  it('execute sees every authorizer-contributed key', async () => {
    const pre = HTPipe(
      { preAuthorize: () => ({ fromPreLeft: 1 }) },
      { preAuthorize: (ctx: any) => ({ fromPreRight: ctx.fromPreLeft + 1 }) }
    );
    const fin = HTPipe(
      {
        finalAuthorize: (ctx: any) => ({ fromFinalLeft: ctx.fromPreRight + 1 }),
      },
      {
        finalAuthorize: (ctx: any) => ({
          fromFinalRight: ctx.fromFinalLeft + 1,
        }),
      }
    );
    const handler = toExpressHandler({
      sanitizeInputs: (i: any) => i,
      ...pre,
      ...fin,
      execute: (ctx: any) => ({
        sum:
          ctx.fromPreLeft +
          ctx.fromPreRight +
          ctx.fromFinalLeft +
          ctx.fromFinalRight,
      }),
      redactResponse: (u: any) => u,
    } as any);
    const res = fakeRes();
    await handler(
      { params: {}, query: {}, body: {}, headers: {} } as any,
      res,
      vi.fn()
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sum: 10 });
  });
});
