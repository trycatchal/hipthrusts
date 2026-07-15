// Type-level tests for the deps-met machinery's tolerance and diagnostics
// (Finding P1-8): `any`-typed context keys and union stage returns must not
// collapse handler inference to `never`, and genuinely-unmet dependencies
// must fail with the branded HipDepNotMet type (naming stage + key) rather
// than an unreadable `never`.
import mongoose from 'mongoose';
import { describe, expectTypeOf, it } from 'vitest';
import { HTPipe } from '../src/index.js';
import { htMongooseFactory } from '../src/mongoose.js';
import { toNextHandler } from '../src/next.js';

const requiredStages = {
  sanitizeInputs: (i: any) => i,
  preAuthorize: () => true,
  execute: () => ({ done: true }),
  redactResponse: (u: any) => u,
};

describe('deps-met tolerance (P1-8)', () => {
  it('a context key declared as `any` does not collapse inference', () => {
    // Repro 1 from the downstream port: `transferNumber: any` used to make
    // TConf resolve to never ("not assignable to parameter of type 'never'").
    const handler = toNextHandler({
      ...requiredStages,
      loadResources: () => ({ transferNumber: '555' }),
      finalAuthorize: (ctx: { transferNumber: any }) => !!ctx.transferNumber,
    });
    expectTypeOf(handler).toBeFunction();
  });

  it('a union loadResources return (conditional shape) is accepted when a member provides the key', () => {
    // Repro 2: `if (!doc) return {}; return { doc, extra }` — a union return.
    const handler = toNextHandler({
      ...requiredStages,
      loadResources: () => {
        if (Math.random() > 0.5) {
          return {};
        }
        return { doc: { id: 'x' }, extra: 1 };
      },
      finalAuthorize: (ctx: { doc: { id: string } }) => !!ctx.doc,
    });
    expectTypeOf(handler).toBeFunction();
  });

  it('preAuthorize returns with a false branch still count as providers', () => {
    const handler = toNextHandler({
      ...requiredStages,
      preAuthorize: () => {
        if (Math.random() > 0.5) {
          return false as const;
        }
        return { role: 'admin' };
      },
      finalAuthorize: (ctx: { role: string }) => ctx.role === 'admin',
    });
    expectTypeOf(handler).toBeFunction();
  });

  it('a genuinely-unmet dependency is still a compile error (branded, not never)', () => {
    // @ts-expect-error - nothing contributes `doc`; the error mentions
    // HipDepNotMet<'finalAuthorize', 'doc'> instead of `never`.
    toNextHandler({
      ...requiredStages,
      finalAuthorize: (ctx: { doc: { id: string } }) => !!ctx.doc,
    });
  });
});

describe('scoped list endpoints require a queryScope provider (P2-10)', () => {
  const listModel = {
    find: (_filter: any) => ({ exec: async () => [] as any[] }),
  };

  it('compiles when a fragment contributes queryScope', () => {
    const handler = toNextHandler(
      HTPipe(
        {
          loadResources: (ctx: { ambient: { tenantIds: string[] } }) => ({
            queryScope: { tenant: { $in: ctx.ambient.tenantIds } } as Record<
              string,
              unknown
            >,
          }),
        },
        {
          extractAmbient: (raw: any) => ({
            tenantIds: (raw.tenantIds || []) as string[],
          }),
          sanitizeInputs: (i: any) => i,
          preAuthorize: () => true,
          finalAuthorize: () => true,
          ...htMongooseFactory(mongoose).findScoped(listModel),
          redactResponse: (u: any) => u,
        }
      )
    );
    expectTypeOf(handler).toBeFunction();
  });

  it('using findScoped without any scope-providing fragment fails to compile', () => {
    // @ts-expect-error - nothing contributes `queryScope`
    toNextHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      ...htMongooseFactory(mongoose).findScoped(listModel),
      redactResponse: (u: any) => u,
    });
  });
});
