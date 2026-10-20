// Type-level tests for ctx.defer (post-response work) and the optional etag
// stage (conditional GET).
import { describe, expectTypeOf, it } from 'vitest';
import {
  Defer,
  ETagResult,
  FinalAuthorize,
  finishPipe,
  FinallyInfo,
  HTPipe,
  LoadResources,
  OnErrorInfo,
  PreAuthorize,
  SanitizeInputsSlices,
} from '../src/index.js';
import { defineExpressHandler } from '../src/express.js';
import { defineNextHandler, toNextHandler } from '../src/next.js';
import { toTrpcProcedure } from '../src/trpc.js';

const Pipe = HTPipe(
  { extractAmbient: (raw: any) => ({ userId: String(raw.userId) }) },
  SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
  PreAuthorize(() => true),
  FinalAuthorize(() => true)
);

describe('ctx.defer', () => {
  it('is on every trailing stage ctx from preAuthorize through responseMeta', () => {
    finishPipe(Pipe, {
      preAuthorize: (ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return true;
      },
      loadResources: (ctx) => {
        ctx.defer(async () => {});
        ctx.defer(() => {});
        return { header: { v: 1 } };
      },
      finalAuthorize: (ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return true;
      },
      etag: (ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return null;
      },
      execute: (ctx) => {
        // @ts-expect-error - a task takes no arguments
        ctx.defer((x: number) => x);
        return { n: ctx.header.v };
      },
      redactResponse: (unsafe, ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return unsafe;
      },
      responseMeta: (ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return {};
      },
    });
  });

  it('is on the define*Handler contexts', () => {
    defineNextHandler({
      sanitizeInputs: (i) => i,
      preAuthorize: (ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return true;
      },
      finalAuthorize: (ctx) => {
        expectTypeOf(ctx.defer).toEqualTypeOf<Defer>();
        return true;
      },
      execute: (ctx) => {
        ctx.defer(() => {});
        return {};
      },
      redactResponse: (unsafe) => unsafe,
    });
    defineExpressHandler({
      sanitizeInputs: (i) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: (ctx) => {
        ctx.defer(() => {});
        return {};
      },
      redactResponse: (unsafe) => unsafe,
    });
  });

  it('a hand-annotated HTPipe stage may consume defer (deps-met knows it)', () => {
    const handler = HTPipe(
      Pipe,
      LoadResources((ctx: { defer: Defer }) => {
        ctx.defer(() => {});
        return { doc: 1 };
      }),
      {
        execute: (ctx: { doc: number; defer: Defer }) => ({ n: ctx.doc }),
        redactResponse: (u: { n: number }) => u,
      }
    );
    expectTypeOf(toNextHandler(handler)).toBeFunction();
  });

  it('is reserved: a trailing stage returning `defer` is a compile error', () => {
    finishPipe(Pipe, {
      // @ts-expect-error - `defer` is a reserved context key
      loadResources: () => ({ defer: 'mine' }),
      execute: () => ({}),
    });
    finishPipe(Pipe, {
      // @ts-expect-error - `defer` is a reserved context key
      finalAuthorize: () => ({ defer: 1 }),
      execute: () => ({}),
    });
  });

  it('is reserved at the adapter boundary too', () => {
    const shadowing = HTPipe(
      Pipe,
      LoadResources(() => ({ defer: 'mine' })),
      { execute: () => ({}), redactResponse: (u: any) => u }
    );
    // @ts-expect-error - loadResources shadows the reserved `defer` key
    toNextHandler(shadowing);
    // @ts-expect-error - same guard on tRPC
    toTrpcProcedure(shadowing);
  });
});

describe('etag stage', () => {
  it("sees finalAuthorize's contributions and returns an ETagResult", () => {
    finishPipe(Pipe, {
      loadResources: () => ({ header: { computedAt: new Date() } }),
      finalAuthorize: () => ({ role: 'reader' as const }),
      etag: (ctx) => {
        expectTypeOf(ctx.role).toEqualTypeOf<'reader'>();
        expectTypeOf(ctx.header.computedAt).toEqualTypeOf<Date>();
        return `v-${ctx.header.computedAt.getTime()}`;
      },
      execute: () => ({ n: 1 }),
      redactResponse: (unsafe) => unsafe,
    });
  });

  it('accepts a bare value, { value, weak }, null and promises of them', () => {
    const rest = {
      execute: () => ({ n: 1 }),
      redactResponse: (unsafe: { n: number }) => unsafe,
    };
    finishPipe(Pipe, { etag: () => 'abc', ...rest });
    finishPipe(Pipe, { etag: () => ({ value: 'abc', weak: true }), ...rest });
    finishPipe(Pipe, { etag: () => null, ...rest });
    finishPipe(Pipe, { etag: async () => ({ value: 'abc' }), ...rest });
    finishPipe(Pipe, { etag: async () => undefined, ...rest });
    expectTypeOf<'abc'>().toExtend<ETagResult>();
  });

  it('rejects other return types', () => {
    finishPipe(Pipe, {
      // @ts-expect-error - an etag is a string or { value, weak }
      etag: () => 42,
    });
  });

  it("makes responseMeta's `response` optional (a 304 has none)", () => {
    finishPipe(Pipe, {
      etag: () => 'v1',
      execute: () => ({ n: 1 }),
      redactResponse: (unsafe) => unsafe,
      responseMeta: (ctx) => {
        // @ts-expect-error - response is absent on a 304
        void ctx.response.n;
        if (ctx.response) {
          expectTypeOf(ctx.response).toEqualTypeOf<{ n: number }>();
        }
        return { headers: { 'Cache-Control': 'private, no-cache' } };
      },
    });
  });

  it('…also when the etag stage lives in the pipe', () => {
    // Like responseMeta, etag is a non-stage key: it rides any fragment that
    // also declares a stage, right-wins.
    const WithETag = HTPipe(Pipe, {
      etag: () => 'v1',
      execute: () => ({ n: 1 }),
    });
    finishPipe(WithETag, {
      redactResponse: (unsafe) => unsafe,
      responseMeta: (ctx) => {
        // @ts-expect-error - response is absent on a 304
        void ctx.response.n;
        return {};
      },
    });
  });

  it('…and stays required without an etag stage', () => {
    finishPipe(Pipe, {
      execute: () => ({ n: 1 }),
      redactResponse: (unsafe) => unsafe,
      responseMeta: (ctx) => {
        expectTypeOf(ctx.response).toEqualTypeOf<{ n: number }>();
        return {};
      },
    });
  });

  it('is part of the finished pipe and accepted by the adapters', () => {
    const finished = finishPipe(Pipe, {
      etag: () => ({ value: 'v1', weak: true }),
      execute: () => ({ n: 1 }),
      redactResponse: (unsafe) => unsafe,
    });
    expectTypeOf(finished.etag).returns.toExtend<ETagResult>();
    expectTypeOf(toNextHandler(finished)).toBeFunction();
  });

  it('is typed on the define*Handler configs', () => {
    defineNextHandler({
      sanitizeInputs: (i) => i,
      preAuthorize: () => true,
      finalAuthorize: () => ({ version: 3 }),
      etag: (ctx) => `v${ctx.version}`,
      execute: () => ({}),
      redactResponse: (unsafe) => unsafe,
    });
  });
});

describe('adapter options', () => {
  it('finally / scheduleAfterResponse / onError phases', () => {
    toNextHandler(
      HTPipe(Pipe, { execute: () => ({}), redactResponse: (u: any) => u }),
      {
        finally: (info) => {
          expectTypeOf(info).toEqualTypeOf<FinallyInfo>();
          expectTypeOf(info.outcome).toEqualTypeOf<
            'success' | 'not-modified' | 'redirect' | 'error'
          >();
        },
        scheduleAfterResponse: (run) => {
          expectTypeOf(run).toEqualTypeOf<() => Promise<void>>();
        },
        onError: (_error, info) => {
          expectTypeOf(info.phase).toEqualTypeOf<
            'defer' | 'afterResponse' | 'finally' | undefined
          >();
        },
      }
    );
    expectTypeOf<OnErrorInfo['phase']>().toEqualTypeOf<
      'defer' | 'afterResponse' | 'finally' | undefined
    >();
  });
});
