// Type-level tests for finishPipe: the trailing handler's stage callbacks get
// their context types inferred from the pipe (zero annotations), phantom
// context keys are compile errors, and pipe-internal deps-met requirements
// still surface as HipDepNotMet through the adapters.
import mongoose from 'mongoose';
import { describe, expectTypeOf, it } from 'vitest';
import { finishPipe, HTPipe, SanitizeInputsSlices } from '../src/index.js';
import { htMongooseFactory } from '../src/mongoose.js';
import { toNextHandler } from '../src/next.js';

const AuthedPipe = HTPipe(
  {
    extractAmbient: (raw: any) => ({
      principal: { id: String(raw.userId), roles: [] as string[] },
    }),
  },
  SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
  {
    preAuthorize: (ctx: {
      ambient: { principal: { id: string; roles: string[] } };
    }) => ({ principal: ctx.ambient.principal }),
  }
);

describe('finishPipe trailing-handler inference', () => {
  it('infers every trailing stage ctx from the pipe with zero annotations', () => {
    const finished = finishPipe(AuthedPipe, {
      loadResources: (ctx) => {
        expectTypeOf(ctx.principal).toEqualTypeOf<{
          id: string;
          roles: string[];
        }>();
        // UNSAFE_SLICES / index carriers are stripped from the computed inputs.
        expectTypeOf(ctx.inputs).toEqualTypeOf<{ params: { id: string } }>();
        return { doc: { id: ctx.inputs.params.id, ownerId: 'o1' } };
      },
      finalAuthorize: (ctx) => {
        expectTypeOf(ctx.doc).toEqualTypeOf<{ id: string; ownerId: string }>();
        return ctx.doc.ownerId === ctx.principal.id && { canWrite: true };
      },
      execute: (ctx) => {
        expectTypeOf(ctx.canWrite).toEqualTypeOf<boolean>();
        return { id: ctx.doc.id, wrote: ctx.canWrite };
      },
      redactResponse: (unsafe, ctx) => {
        expectTypeOf(unsafe).toEqualTypeOf<{ id: string; wrote: boolean }>();
        expectTypeOf(ctx.principal.id).toEqualTypeOf<string>();
        return unsafe;
      },
    });
    const handler = toNextHandler(finished);
    expectTypeOf(handler).toBeFunction();
  });

  it('an async trailing loadResources contributes its awaited return', () => {
    const finished = finishPipe(AuthedPipe, {
      loadResources: async (ctx) => ({ doc: { id: ctx.inputs.params.id } }),
      finalAuthorize: (ctx) => {
        expectTypeOf(ctx.doc).toEqualTypeOf<{ id: string }>();
        return !!ctx.doc;
      },
      execute: (ctx) => ctx.doc,
      redactResponse: (unsafe) => unsafe,
    });
    expectTypeOf(toNextHandler(finished)).toBeFunction();
  });

  it('consuming a phantom ctx key is a compile error', () => {
    finishPipe(AuthedPipe, {
      finalAuthorize: (ctx) => {
        // @ts-expect-error - nothing contributes `phantom` to the context
        return !!ctx.phantom;
      },
      execute: () => ({ ok: true }),
      redactResponse: (unsafe) => unsafe,
    });
  });

  it('extraction/sanitization stages are rejected in the trailing handler', () => {
    finishPipe(AuthedPipe, {
      // @ts-expect-error - sanitize stages belong in the pipe, not the handler
      sanitizeInputs: (unsafe: any) => unsafe,
      execute: () => ({ ok: true }),
      redactResponse: (unsafe) => unsafe,
    });
  });
});

describe('finishPipe preserves pipe-internal HipDepNotMet enforcement', () => {
  const listModel = {
    find: (_filter: any) => ({ exec: async () => [] as any[] }),
  };
  const ScopedPipe = HTPipe(
    SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
    { preAuthorize: () => true },
    htMongooseFactory(mongoose).findScoped(listModel)
  );

  it('a handler contributing queryScope compiles', () => {
    const finished = finishPipe(ScopedPipe, {
      preAuthorize: (ctx) => ({
        queryScope: { tenant: ctx.inputs.params.id } as Record<string, unknown>,
      }),
      finalAuthorize: () => true,
      redactResponse: (unsafe) => unsafe,
    });
    expectTypeOf(toNextHandler(finished)).toBeFunction();
  });

  it('a handler NOT contributing queryScope fails at the adapter boundary', () => {
    const finished = finishPipe(ScopedPipe, {
      finalAuthorize: () => true,
      redactResponse: (unsafe) => unsafe,
    });
    // @ts-expect-error - the pipe's findScoped requires `queryScope`
    toNextHandler(finished);
  });
});
