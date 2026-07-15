import { describe, expect, it } from 'vitest';
import { HTPipe } from '../src';
import { executeHipthrustable, withDefaultImplementations } from '../src/core';
import {
  HipBadInputs,
  HipConflict,
  HipForbidden,
  HipInternal,
  HipNotFound,
  HipRedirect,
  isHipError,
} from '../src/errors';

function buildHandler(overrides: Record<string, any> = {}) {
  return withDefaultImplementations({
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: () => ({ ok: true }),
    redactResponse: (u: any) => u,
    ...overrides,
  } as any);
}

describe('executeHipthrustable lifecycle', () => {
  it('runs the full lifecycle and threads context through stages', async () => {
    const handler = withDefaultImplementations({
      sanitizeInputs: (i: { body: { n: number } }) => ({ n: i.body.n }),
      preAuthorize: () => ({ allowed: true }),
      loadResources: (ctx: { inputs: { n: number } }) => ({
        loaded: ctx.inputs.n + 1,
      }),
      finalAuthorize: (ctx: { loaded: number }) => ({ checked: ctx.loaded }),
      execute: (ctx: { inputs: { n: number }; loaded: number }) => ({
        sum: ctx.inputs.n + ctx.loaded,
      }),
      redactResponse: (u: { sum: number }) => ({ sum: u.sum }),
    } as any);

    const { response } = await executeHipthrustable(handler, {
      params: {},
      query: {},
      body: { n: 2 },
      headers: {},
    });
    expect(response).toEqual({ sum: 5 });
  });

  it('maps a sanitizeInputs throw to HipBadInputs', async () => {
    const handler = buildHandler({
      sanitizeInputs: () => {
        throw new Error('boom');
      },
    });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipBadInputs
    );
  });

  it('maps a denied preAuthorize to HipForbidden', async () => {
    const handler = buildHandler({ preAuthorize: () => false });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipForbidden
    );
  });

  it('maps a denied finalAuthorize to HipForbidden', async () => {
    const handler = buildHandler({ finalAuthorize: () => false });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipForbidden
    );
  });

  it('maps an unexpected execute throw to HipInternal', async () => {
    const handler = buildHandler({
      execute: () => {
        throw new Error('kaboom');
      },
    });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipInternal
    );
  });

  it('passes a thrown HipError through unchanged', async () => {
    const handler = buildHandler({
      execute: () => {
        throw new HipConflict('already exists');
      },
    });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipConflict
    );
  });

  it('rejects with a HipRedirect as-is', async () => {
    const handler = buildHandler({
      execute: () => {
        throw new HipRedirect('/login');
      },
    });
    await expect(executeHipthrustable(handler, {})).rejects.toBeInstanceOf(
      HipRedirect
    );
  });

  // Regression test for the transformThrowPossiblyAsync sync-throw bug: an
  // async-capable stage (loadResources) that throws *synchronously* must still
  // be transformed to a HipError, not leak the raw error. (Since Finding P0-4
  // the transformed error is HipInternal — 404 is reserved for a deliberate
  // HipNotFound throw.)
  it('transforms a SYNCHRONOUS throw from loadResources to HipInternal', async () => {
    const handler = buildHandler({
      loadResources: () => {
        throw new Error('sync boom from an async-capable stage');
      },
    });
    let caught: unknown;
    try {
      await executeHipthrustable(handler, {});
    } catch (e) {
      caught = e;
    }
    expect(isHipError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(HipInternal);
  });

  it('still transforms an ASYNCHRONOUS rejection from loadResources to HipInternal', async () => {
    const handler = buildHandler({
      loadResources: async () => {
        throw new Error('async boom');
      },
    });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipInternal
    );
  });
});

describe('unknown-error routing (Finding P0-4)', () => {
  const base = {
    extractAmbient: () => ({}),
    extractInputs: (raw: any) => raw,
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    loadResources: () => ({}),
    finalAuthorize: () => true,
    execute: () => ({ ok: true }),
    redactResponse: (u: any) => u,
  };

  async function run(overrides: Record<string, any>) {
    try {
      await executeHipthrustable({ ...base, ...overrides } as any, {});
      return undefined;
    } catch (e) {
      return e;
    }
  }

  it('an unknown throw in loadResources becomes HipInternal with the original as cause', async () => {
    const dbDown = new Error('db down');
    const caught = await run({
      loadResources: () => {
        throw dbDown;
      },
    });
    expect(caught).toBeInstanceOf(HipInternal);
    expect((caught as HipInternal).message).toBe('Internal server error');
    expect((caught as HipInternal).cause).toBe(dbDown);
  });

  it('an unknown throw in preAuthorize/finalAuthorize becomes HipInternal, not 403', async () => {
    for (const stage of ['preAuthorize', 'finalAuthorize']) {
      const boom = new Error('db down');
      const caught = await run({
        [stage]: () => {
          throw boom;
        },
      });
      expect(caught).toBeInstanceOf(HipInternal);
      expect((caught as HipInternal).cause).toBe(boom);
    }
  });

  it('a deliberate HipNotFound from loadResources still surfaces as-is', async () => {
    const caught = await run({
      loadResources: () => {
        throw new HipNotFound('Resource not found');
      },
    });
    expect(caught).toBeInstanceOf(HipNotFound);
  });

  it('unknown throws during input stages stay HipBadInputs and chain the cause', async () => {
    const zodish = new Error('invalid');
    const caught = await run({
      sanitizeInputs: () => {
        throw zodish;
      },
    });
    expect(caught).toBeInstanceOf(HipBadInputs);
    expect((caught as HipBadInputs).cause).toBe(zodish);
  });

  it('an unknown throw in execute uses the standard scrub message and chains the cause', async () => {
    const boom = new Error('whoops');
    const caught = await run({
      execute: () => {
        throw boom;
      },
    });
    expect(caught).toBeInstanceOf(HipInternal);
    expect((caught as HipInternal).message).toBe('Internal server error');
    expect((caught as HipInternal).cause).toBe(boom);
  });

  it('returning false from the authorize stages still yields HipForbidden', async () => {
    const pre = await run({ preAuthorize: () => false });
    expect(pre).toBeInstanceOf(HipForbidden);
    const fin = await run({ finalAuthorize: () => false });
    expect(fin).toBeInstanceOf(HipForbidden);
  });
});

describe('redactResponse receives the final context (Finding P2-11)', () => {
  it('a two-param redactor can branch on an authz flag from finalAuthorize', async () => {
    const handler = withDefaultImplementations({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => ({ canSeeEmails: false }),
      execute: () => ({ rows: [{ name: 'a', email: 'a@x.com' }] }),
      redactResponse: (
        unsafe: { rows: { name: string; email: string }[] },
        ctx: { canSeeEmails: boolean }
      ) =>
        ctx.canSeeEmails
          ? unsafe.rows
          : unsafe.rows.map(({ name }) => ({ name })),
    } as any);
    const { response } = await executeHipthrustable(handler as any, {});
    expect(response).toEqual([{ name: 'a' }]);
  });

  it('one-param redactors keep working unchanged', async () => {
    const handler = withDefaultImplementations({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => ({ a: 1, secret: 's' }),
      redactResponse: (u: { a: number; secret: string }) => ({ a: u.a }),
    } as any);
    const { response } = await executeHipthrustable(handler as any, {});
    expect(response).toEqual({ a: 1 });
  });

  it('piped redactors both receive the context', async () => {
    const seen: any[] = [];
    const piped = HTPipe(
      {
        redactResponse: (u: any, ctx: any) => {
          seen.push(ctx.role);
          return u;
        },
      },
      {
        redactResponse: (u: any, ctx: any) => {
          seen.push(ctx.role);
          return u;
        },
      }
    );
    (piped as any).redactResponse({ x: 1 }, { role: 'admin' });
    expect(seen).toEqual(['admin', 'admin']);
  });
});
