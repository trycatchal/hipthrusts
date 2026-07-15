// Type-level tests for HTPipe composition (Finding P0-1 / P1-7).
// Run via `vitest --typecheck` (enabled in vitest.config.ts).
import { describe, expectTypeOf, it } from 'vitest';
import { HTPipe, SanitizeInputsSlices } from '../src/index.js';
import { toNextHandler } from '../src/next.js';

describe('HTPipe sanitizeInputs composition (P0-1)', () => {
  it('keeps both slices visible after piping two SanitizeInputsSlices fragments', () => {
    const piped = HTPipe(
      SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
      SanitizeInputsSlices({ body: (b: any) => ({ name: String(b.name) }) })
    );
    type SanitizedOut = ReturnType<(typeof piped)['sanitizeInputs']>;
    expectTypeOf<SanitizedOut['params']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<SanitizedOut['body']>().toEqualTypeOf<{ name: string }>();
  });

  it('a later stage can consume the LEFT slice through an adapter (README shape)', () => {
    // This is the canonical multi-slice handler from the README. Before the
    // P0-1 fix, the composed sanitizeInputs return type dropped `params`
    // (keeping only the right fragment's return), so this failed to typecheck.
    const handler = toNextHandler(
      HTPipe(
        SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
        SanitizeInputsSlices({ body: (b: any) => ({ name: String(b.name) }) }),
        {
          preAuthorize: () => true,
          loadResources: async (ctx: {
            inputs: { params: { id: string } };
          }) => ({
            thing: { ownerId: 'x' } as { ownerId: string } | null,
          }),
          finalAuthorize: (ctx: { thing: { ownerId: string } | null }) =>
            !!ctx.thing,
          execute: (ctx: { thing: { ownerId: string } | null }) => ctx.thing,
          redactResponse: (t: unknown) => t,
        }
      )
    );
    expectTypeOf(handler).toBeFunction();
  });

  it('full-replace sanitizer on the right does not inherit left keys', () => {
    const piped = HTPipe(
      SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
      { sanitizeInputs: (_all: any) => ({ replaced: true as const }) }
    );
    type SanitizedOut = ReturnType<(typeof piped)['sanitizeInputs']>;
    expectTypeOf<SanitizedOut>().toEqualTypeOf<{ replaced: true }>();
  });
});

describe('HTPipe non-stage key passthrough (P0-2)', () => {
  it('the piped type keeps responseMeta with right-wins semantics', () => {
    const piped = HTPipe(
      { preAuthorize: () => true, responseMeta: { status: 200 } },
      {
        sanitizeInputs: (i: any) => i,
        preAuthorize: () => true,
        finalAuthorize: () => true,
        execute: () => ({}),
        redactResponse: (u: any) => u,
        responseMeta: { status: 201 },
      }
    );
    expectTypeOf(piped.responseMeta).toEqualTypeOf<{ status: number }>();
  });
});

describe('HTPipe arity beyond 4 (P1-7)', () => {
  it('composes 6 fragments where the 6th consumes context from fragments 1-5', () => {
    const piped = HTPipe(
      SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
      SanitizeInputsSlices({ body: (b: any) => ({ name: String(b.name) }) }),
      { preAuthorize: () => ({ role: 'admin' as const }) },
      {
        loadResources: (ctx: { inputs: { params: { id: string } } }) => ({
          doc: { id: ctx.inputs.params.id, ownerId: 'o1' },
        }),
      },
      {
        finalAuthorize: (ctx: {
          role: 'admin';
          doc: { id: string; ownerId: string };
        }) => ({ canWrite: ctx.role === 'admin' }),
      },
      {
        execute: (ctx: {
          inputs: { body: { name: string } };
          doc: { id: string; ownerId: string };
          canWrite: boolean;
        }) => ({ saved: ctx.canWrite, name: ctx.inputs.body.name }),
        redactResponse: (u: { saved: boolean; name: string }) => u,
        responseMeta: { status: 201 },
      }
    );
    expectTypeOf(piped.responseMeta).toEqualTypeOf<{ status: number }>();
    type ExecOut = Awaited<ReturnType<(typeof piped)['execute']>>;
    expectTypeOf<ExecOut>().toEqualTypeOf<{ saved: boolean; name: string }>();
  });

  it('composes 8 fragments', () => {
    const noop = { preAuthorize: () => true };
    const piped = HTPipe(noop, noop, noop, noop, noop, noop, noop, {
      execute: () => ({ ok: true }),
    });
    expectTypeOf(piped.preAuthorize).toBeFunction();
    expectTypeOf(piped.execute).toBeFunction();
  });
});

describe('redactResponse context deps-met (P2-11)', () => {
  const baseStages = {
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    execute: () => ({ rows: [] as { name: string; email: string }[] }),
  };

  it('a two-param redactor whose ctx key IS contributed compiles', () => {
    const handler = toNextHandler({
      ...baseStages,
      finalAuthorize: () => ({ canSeeEmails: true }),
      redactResponse: (
        unsafe: { rows: { name: string; email: string }[] },
        ctx: { canSeeEmails: boolean }
      ) => (ctx.canSeeEmails ? unsafe.rows : []),
    });
    expectTypeOf(handler).toBeFunction();
  });

  it('a two-param redactor requiring an un-contributed ctx key fails deps-met', () => {
    // @ts-expect-error - nothing contributes `canSeeEmails` to the context
    toNextHandler({
      ...baseStages,
      finalAuthorize: () => true,
      redactResponse: (
        unsafe: { rows: { name: string; email: string }[] },
        ctx: { canSeeEmails: boolean }
      ) => (ctx.canSeeEmails ? unsafe.rows : []),
    });
  });
});

describe('strict sanitization (unsanitized slices are compile errors downstream)', () => {
  it('consuming an unsanitized slice in a later stage fails deps-met', () => {
    // `query` was never sanitized, so ctx.inputs has no `query` key (the raw
    // remainder rides UNSAFE_SLICES and core strips it).
    const piped = HTPipe(
      SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
      {
        preAuthorize: () => true,
        finalAuthorize: () => true,
        execute: (ctx: { inputs: { query: { foo: string } } }) =>
          ctx.inputs.query,
        redactResponse: (u: unknown) => u,
      }
    );
    // @ts-expect-error - consuming an unsanitized slice must not compile
    toNextHandler(piped);
  });

  it('an explicit no-op slice types the raw slice through', () => {
    const piped = HTPipe(
      SanitizeInputsSlices({
        params: (p: any) => ({ id: String(p.id) }),
        query: (q: any) => q as Record<string, string>,
      }),
      {
        preAuthorize: () => true,
        finalAuthorize: () => true,
        execute: (ctx: {
          inputs: { params: { id: string }; query: Record<string, string> };
        }) => ctx.inputs,
        redactResponse: (u: unknown) => u,
      }
    );
    const handler = toNextHandler(piped);
    expectTypeOf(handler).toBeFunction();
  });
});
