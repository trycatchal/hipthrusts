import { describe, expect, it } from 'vitest';
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
  // be transformed to the stage's semantic HipError, not leak the raw error.
  it('transforms a SYNCHRONOUS throw from loadResources to HipNotFound', async () => {
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
    expect(caught).toBeInstanceOf(HipNotFound);
  });

  it('still transforms an ASYNCHRONOUS rejection from loadResources to HipNotFound', async () => {
    const handler = buildHandler({
      loadResources: async () => {
        throw new Error('async boom');
      },
    });
    await expect(executeHipthrustable(handler, {})).rejects.toThrow(
      HipNotFound
    );
  });
});
