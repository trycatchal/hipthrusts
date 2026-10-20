// Type-level regression tests for finishPipe's trailing-handler inference
// against spread-in redactors (item 0 of the 1.3.0 batch) and for the typed
// functional responseMeta context (item 1).
//
// The bug: a redactor whose `context` parameter is typed `any` — which is what
// RedactResponse gives any redactor built outside a contextual position, e.g.
// RedactResponseWithZod — inferred `any` back into finishPipe's
// TPre/TLoad/TFinal, silently erasing every other trailing stage's ctx to
// `any`. tsc stayed green. The trailing handler's context parameters are now
// NoInfer, so stage types are inferred from stage RETURNS only.
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  ExtractAmbient,
  FinalAuthorize,
  finishPipe,
  HipTrailingDepNotMet,
  HTPipe,
  PreAuthorize,
  RedactResponse,
  RedactResponseSwitch,
  SanitizeInputsSlices,
} from '../src/index.js';
import { toNextHandler } from '../src/next.js';
import { htZodFactory } from '../src/zod.js';

const { RedactResponseWithZod } = htZodFactory();

type IsAny<T> = 0 extends 1 & T ? true : false;

const Pipe = HTPipe(
  ExtractAmbient((raw: { userId: string | null }) => ({ userId: raw.userId })),
  SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
  FinalAuthorize(() => true)
);

// The same pipe, complete enough for an adapter (it has a preAuthorize).
const RunnablePipe = HTPipe(
  Pipe,
  PreAuthorize(() => true)
);

const Out = z.object({ n: z.number() });

// A redactor built once and shared — its context parameter is `any`.
const sharedRedactor = RedactResponse((u: { n: number }) => ({ n: u.n }));

describe('item 0: spread redactors no longer erase the handler ctx', () => {
  it('the exact repro: RedactResponseWithZod spread into the handler', () => {
    finishPipe(Pipe, {
      execute: (ctx) => {
        // @ts-expect-error - ctx is a typed context object, not a number
        const n: number = ctx;
        return { n };
      },
      ...RedactResponseWithZod(Out),
    });
  });

  it('control: the zod redactor composed into the pipe', () => {
    finishPipe(HTPipe(Pipe, RedactResponseWithZod(Out)), {
      execute: (ctx) => {
        // @ts-expect-error - ctx is typed
        const n: number = ctx;
        return { n };
      },
    });
  });

  it('control: a hand-written redactor taking `any`', () => {
    finishPipe(Pipe, {
      execute: (ctx) => {
        // @ts-expect-error - ctx is typed
        const n: number = ctx;
        return { n };
      },
      ...RedactResponse((u: any) => u as { n: number }),
    });
  });

  it('a shared RedactResponse (built outside the call) spread in', () => {
    finishPipe(Pipe, {
      execute: (ctx) => {
        // @ts-expect-error - ctx is typed
        const n: number = ctx;
        return { n: 1 };
      },
      ...sharedRedactor,
    });
  });

  it('RedactResponseSwitch built from RedactResponseWithZod cases', () => {
    const Switch = RedactResponseSwitch('isAdmin', {
      true: RedactResponseWithZod(Out),
      false: RedactResponseWithZod(Out),
    });
    finishPipe(Pipe, {
      finalAuthorize: () => ({ isAdmin: true }),
      execute: (ctx) => {
        // @ts-expect-error - ctx is typed
        const n: number = ctx;
        expectTypeOf(ctx.isAdmin).toEqualTypeOf<boolean>();
        return { n: 1 };
      },
      ...Switch,
    });
  });

  // Every trailing stage, against every flavour of redactor: none may see an
  // `any` context.
  it('no trailing stage ctx is `any`, whatever redactor is spread in', () => {
    const redactors = {
      zod: RedactResponseWithZod(Out),
      shared: sharedRedactor,
      inline: RedactResponse((u: any) => u as { n: number }),
      switch: RedactResponseSwitch('isAdmin', {
        true: RedactResponseWithZod(Out),
        false: sharedRedactor,
      }),
    };

    finishPipe(Pipe, {
      preAuthorize: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return { isAdmin: true };
      },
      loadResources: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return { doc: { n: 1 } };
      },
      finalAuthorize: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return true;
      },
      etag: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return null;
      },
      execute: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return ctx.doc;
      },
      responseMeta: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return {};
      },
      ...redactors.zod,
    });

    const stagesAgainst = (
      redactor: (typeof redactors)[keyof typeof redactors]
    ) => redactor;
    for (const redactor of [
      stagesAgainst(redactors.shared),
      stagesAgainst(redactors.inline),
      stagesAgainst(redactors.switch),
    ]) {
      expectTypeOf(redactor).not.toBeAny();
    }

    finishPipe(Pipe, {
      preAuthorize: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return { isAdmin: true };
      },
      execute: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return { n: 1 };
      },
      ...redactors.shared,
    });
    finishPipe(Pipe, {
      preAuthorize: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return { isAdmin: true };
      },
      execute: (ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        return { n: 1 };
      },
      ...redactors.switch,
    });
  });

  it('a pre-built stage with an `any` parameter does not poison the others', () => {
    const anyExecute = (ctx: any) => ({ n: Number(ctx.inputs.params.id) });
    finishPipe(Pipe, {
      loadResources: () => ({ doc: { n: 1 } }),
      finalAuthorize: (ctx) => {
        expectTypeOf(ctx.doc).toEqualTypeOf<{ n: number }>();
        return true;
      },
      execute: anyExecute,
      redactResponse: (unsafe, ctx) => {
        expectTypeOf<IsAny<typeof ctx>>().toEqualTypeOf<false>();
        expectTypeOf(unsafe).toEqualTypeOf<{ n: number }>();
        return unsafe;
      },
    });
  });
});

describe("item 1: a functional responseMeta's ctx is the final context", () => {
  it('is contextually typed: accumulated ctx + execute keys + response', () => {
    const finished = finishPipe(RunnablePipe, {
      loadResources: () => ({ doc: { id: 'd1' } }),
      execute: (ctx) => ({ n: 1, internal: ctx.doc.id }),
      redactResponse: (unsafe) => ({ n: unsafe.n }),
      responseMeta: (ctx) => {
        expectTypeOf(ctx.response).toEqualTypeOf<{ n: number }>();
        expectTypeOf(ctx.internal).toEqualTypeOf<string>();
        expectTypeOf(ctx.doc).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.ambient.userId).toEqualTypeOf<string | null>();
        expectTypeOf(ctx.inputs.params.id).toEqualTypeOf<string>();
        // @ts-expect-error - nothing contributes `phantom`
        void ctx.phantom;
        return { headers: { 'X-Doc': ctx.doc.id } };
      },
    });
    expectTypeOf(toNextHandler(finished)).toBeFunction();
  });

  it('`response` is the spread redactor output', () => {
    finishPipe(Pipe, {
      execute: () => ({ n: 1, secret: 's' }),
      ...RedactResponseWithZod(Out),
      responseMeta: (ctx) => {
        expectTypeOf(ctx.response).toEqualTypeOf<{ n: number }>();
        expectTypeOf(ctx.secret).toEqualTypeOf<string>();
        return { status: 200 };
      },
    });
  });

  it('`response` is the pipe redactor output when the handler has none', () => {
    finishPipe(HTPipe(Pipe, RedactResponseWithZod(Out)), {
      execute: () => ({ n: 1 }),
      responseMeta: (ctx) => {
        expectTypeOf(ctx.response).toEqualTypeOf<{ n: number }>();
        return {};
      },
    });
  });

  it('a static responseMeta keeps its exact type on the result', () => {
    const finished = finishPipe(Pipe, {
      execute: () => ({ n: 1 }),
      redactResponse: (unsafe) => unsafe,
      responseMeta: { status: 201 },
    });
    expectTypeOf(finished.responseMeta).toEqualTypeOf<{ status: number }>();
  });

  it('a functional responseMeta must return ResponseMeta', () => {
    finishPipe(Pipe, {
      execute: () => ({ n: 1 }),
      // @ts-expect-error - status must be a number
      responseMeta: () => ({ status: 'created' }),
    });
  });
});

describe('pre-built trailing stages with a typed context requirement', () => {
  const Switch = RedactResponseSwitch('isAdmin', {
    true: RedactResponseWithZod(Out),
    false: sharedRedactor,
  });

  it('compiles when an earlier trailing stage contributes the key', () => {
    const finished = finishPipe(RunnablePipe, {
      preAuthorize: () => ({ isAdmin: true }),
      execute: (ctx) => {
        expectTypeOf(ctx.isAdmin).toEqualTypeOf<boolean>();
        return { n: 1 };
      },
      ...Switch,
    });
    expectTypeOf(toNextHandler(finished)).toBeFunction();
  });

  it('a stage requiring a key nothing contributes yields HipTrailingDepNotMet', () => {
    const finished = finishPipe(RunnablePipe, {
      execute: () => ({ n: 1 }),
      ...Switch,
    });
    expectTypeOf(finished).toEqualTypeOf<
      HipTrailingDepNotMet<'redactResponse', 'isAdmin'>
    >();
    // @ts-expect-error - the spread redactor needs `isAdmin`; nothing provides it
    toNextHandler(finished);
  });

  it('a pre-built authorizer reading a loaded resource', () => {
    const OwnerOnly = FinalAuthorize(
      (ctx: { doc: { ownerId: string }; ambient: { userId: string | null } }) =>
        ctx.doc.ownerId === ctx.ambient.userId
    );
    const finished = finishPipe(RunnablePipe, {
      loadResources: () => ({ doc: { ownerId: 'u1' } }),
      ...OwnerOnly,
      execute: (ctx) => ctx.doc,
      redactResponse: (unsafe) => unsafe,
    });
    expectTypeOf(toNextHandler(finished)).toBeFunction();

    const missing = finishPipe(RunnablePipe, {
      ...OwnerOnly,
      execute: () => ({}),
      redactResponse: (unsafe) => unsafe,
    });
    expectTypeOf(missing).toEqualTypeOf<
      HipTrailingDepNotMet<'finalAuthorize', 'doc'>
    >();
  });
});
