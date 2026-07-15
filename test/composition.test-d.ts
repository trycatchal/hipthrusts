// Type-level tests for HTPipe composition (Finding P0-1 / P1-7).
// Run via `vitest --typecheck` (enabled in vitest.config.ts).
import { describe, expectTypeOf, it } from 'vitest';
import { HTPipe, WithInputSlice } from '../src/index.js';
import { toNextHandler } from '../src/next.js';

describe('HTPipe sanitizeInputs composition (P0-1)', () => {
  it('keeps both slices visible after piping two WithInputSlice fragments', () => {
    const piped = HTPipe(
      WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
      WithInputSlice('body', (b: any) => ({ name: String(b.name) }))
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
        WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
        WithInputSlice('body', (b: any) => ({ name: String(b.name) })),
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
      WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
      { sanitizeInputs: (_all: any) => ({ replaced: true as const }) }
    );
    type SanitizedOut = ReturnType<(typeof piped)['sanitizeInputs']>;
    expectTypeOf<SanitizedOut>().toEqualTypeOf<{ replaced: true }>();
  });
});
