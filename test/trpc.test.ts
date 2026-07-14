import { describe, expect, it } from 'vitest';
import { HipForbidden } from '../src/errors';
import { defineTrpcProcedure, toTrpcProcedure } from '../src/trpc';

function baseConfig(overrides: Record<string, any> = {}) {
  return {
    sanitizeInputs: (unsafe: any) => unsafe,
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: (ctx: any) => ({ echoed: ctx.inputs }),
    redactResponse: (unsafe: any) => unsafe,
    ...overrides,
  } as any;
}

describe('defineTrpcProcedure', () => {
  it('is an identity helper for inference-friendly authoring', () => {
    const config = baseConfig();
    expect(defineTrpcProcedure(config)).toBe(config);
  });
});

describe('toTrpcProcedure', () => {
  it('runs the lifecycle and returns the redacted response directly', async () => {
    const procedure = toTrpcProcedure(baseConfig());
    const result = await procedure({ ctx: {}, input: { name: 'hip' } });
    expect(result).toEqual({ echoed: { name: 'hip' } });
  });

  it('hands the parsed input straight to sanitizeInputs by default', async () => {
    let seen: any;
    const procedure = toTrpcProcedure(
      baseConfig({
        sanitizeInputs: (unsafe: any) => (seen = unsafe),
      })
    );
    await procedure({ ctx: {}, input: { id: '7' } });
    expect(seen).toEqual({ id: '7' });
  });

  it('merges a handler extractInputs over an object input', async () => {
    let seen: any;
    const procedure = toTrpcProcedure(
      baseConfig({
        extractInputs: () => ({ extra: true }),
        sanitizeInputs: (unsafe: any) => (seen = unsafe),
      })
    );
    await procedure({ ctx: {}, input: { id: '7' } });
    expect(seen).toEqual({ id: '7', extra: true });
  });

  it('lets a handler extractInputs fully own the result for non-object inputs', async () => {
    let seen: any;
    const procedure = toTrpcProcedure(
      baseConfig({
        extractInputs: (canonical: any) => ({ wrapped: canonical }),
        sanitizeInputs: (unsafe: any) => (seen = unsafe),
      })
    );
    await procedure({ ctx: {}, input: 42 });
    expect(seen).toEqual({ wrapped: 42 });
  });

  it('exposes the tRPC ctx via extractAmbient', async () => {
    let seenAmbient: any;
    const procedure = toTrpcProcedure(
      baseConfig({
        extractAmbient: (raw: any) => ({ user: raw.ctx.user }),
        preAuthorize: (context: any) => {
          seenAmbient = context.ambient;
          return true;
        },
      })
    );
    await procedure({ ctx: { user: 'alice' }, input: {} });
    expect(seenAmbient).toEqual({ user: 'alice' });
  });

  it('rejects with HipForbidden when preAuthorize denies', async () => {
    const procedure = toTrpcProcedure(baseConfig({ preAuthorize: () => false }));
    await expect(procedure({ ctx: {}, input: {} })).rejects.toThrow(
      HipForbidden
    );
  });

  it('rejects with HipForbidden when finalAuthorize denies', async () => {
    const procedure = toTrpcProcedure(
      baseConfig({ finalAuthorize: () => false })
    );
    await expect(procedure({ ctx: {}, input: {} })).rejects.toThrow(
      HipForbidden
    );
  });

  it('refuses to build a procedure missing a required stage', () => {
    const incomplete = baseConfig();
    delete incomplete.redactResponse;
    expect(() => toTrpcProcedure(incomplete)).toThrow();
  });
});
