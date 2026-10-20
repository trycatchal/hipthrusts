// Post-response work: ctx.defer tasks, the adapters' finally hook, and the
// scheduleAfterResponse test seam — in core and across every adapter.
import express from 'express';
import fastify from 'fastify';
import { Hono } from 'hono';
import { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { executeHipthrustable, withDefaultImplementations } from '../src/core';
import {
  HipForbidden,
  HipInternal,
  HipRedirect,
  isHipError,
} from '../src/errors';
import { toExpressHandler } from '../src/express';
import { toFastifyHandler } from '../src/fastify';
import { toHonoHandler } from '../src/hono';
import {
  FinallyInfo,
  HttpAdapterOptions,
  OnErrorInfo,
} from '../src/http-adapter';
import { toNextHandler } from '../src/next';
import { toTrpcProcedure } from '../src/trpc';

const baseStages = {
  sanitizeInputs: (i: any) => i,
  preAuthorize: () => true,
  finalAuthorize: () => true,
  execute: () => ({ ok: true }),
  redactResponse: (u: any) => u,
};

const full = (h: Record<string, unknown>) =>
  withDefaultImplementations({ ...baseStages, ...h } as any);

describe('ctx.defer in the core lifecycle', () => {
  it('is available from preAuthorize through redactResponse and queues in order', async () => {
    const result = await executeHipthrustable(
      full({
        preAuthorize: (ctx: any) => {
          ctx.defer(() => 'pre');
          return true;
        },
        loadResources: (ctx: any) => {
          ctx.defer(() => 'load');
          return {};
        },
        finalAuthorize: (ctx: any) => {
          ctx.defer(() => 'final');
          return true;
        },
        execute: (ctx: any) => {
          ctx.defer(() => 'exec');
          return { ok: true };
        },
        redactResponse: (u: any, ctx: any) => {
          ctx.defer(() => 'redact');
          return u;
        },
      }) as any,
      {}
    );
    expect(result.deferred.size).toBe(5);
    expect(result.deferred.drain().map((task) => task())).toEqual([
      'pre',
      'load',
      'final',
      'exec',
      'redact',
    ]);
    expect(result.context.defer).toBeTypeOf('function');
  });

  it('does not run anything itself', async () => {
    const task = vi.fn();
    const result = await executeHipthrustable(
      full({
        execute: (ctx: any) => {
          ctx.defer(task);
          return {};
        },
      }) as any,
      {}
    );
    expect(task).not.toHaveBeenCalled();
    expect(result.deferred.size).toBe(1);
  });

  it('is sealed once drained: a late defer throws instead of dropping work', async () => {
    const result = await executeHipthrustable(full({}) as any, {});
    result.deferred.drain();
    expect(() => result.context.defer(() => {})).toThrow(/after the response/);
  });

  it('rejects a non-function task (a stage bug → 500)', async () => {
    await expect(
      executeHipthrustable(
        full({
          execute: (ctx: any) => {
            ctx.defer('nope');
            return {};
          },
        }) as any,
        {}
      )
    ).rejects.toBeInstanceOf(HipInternal);
  });

  it.each(['preAuthorize', 'loadResources', 'finalAuthorize'])(
    'a %s contribution named `defer` is a HipInternal (reserved key)',
    async (stage) => {
      const error = await executeHipthrustable(
        full({ [stage]: () => ({ defer: 'shadow' }) }) as any,
        {}
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HipInternal);
      expect((error as HipInternal).detail).toEqual({
        reason: `${stage} returned the reserved context key "defer"`,
      });
    }
  );

  it("execute output keys can't replace defer on the final context", async () => {
    const result = await executeHipthrustable(
      full({ execute: () => ({ defer: 'data', n: 1 }) }) as any,
      {}
    );
    expect(result.response).toEqual({ defer: 'data', n: 1 });
    expect(result.context.defer).toBeTypeOf('function');
    expect(result.context.n).toBe(1);
  });
});

// --- adapter harnesses ------------------------------------------------------
// Each drives a REAL framework request and returns the status it answered.

type Call = (
  handler: Record<string, unknown>,
  options: HttpAdapterOptions,
  request?: { headers?: Record<string, string> }
) => Promise<number>;

const callNext: Call = async (handler, options, request = {}) => {
  const res = await toNextHandler(
    handler as any,
    options
  )(new NextRequest('http://localhost/x', { headers: request.headers }));
  return res.status;
};

const callHono: Call = async (handler, options, request = {}) => {
  const app = new Hono();
  app.get('/x', toHonoHandler(handler as any, options));
  const res = await app.request('/x', { headers: request.headers });
  return res.status;
};

const callExpress: Call = async (handler, options, request = {}) => {
  const app = express();
  app.get('/x', toExpressHandler(handler as any, options));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      headers: request.headers,
      redirect: 'manual',
    });
    await res.arrayBuffer();
    return res.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

const callFastify: Call = async (handler, options, request = {}) => {
  const app = fastify();
  app.get('/x', toFastifyHandler(handler as any, options));
  const res = await app.inject({
    method: 'GET',
    url: '/x',
    headers: request.headers,
  });
  return res.statusCode;
};

const adapters: [string, Call][] = [
  ['next', callNext],
  ['hono', callHono],
  ['express', callExpress],
  ['fastify', callFastify],
];

// The test seam: collect each request's post-response runner and await it.
function seam() {
  const runs: Array<() => Promise<void>> = [];
  return {
    scheduleAfterResponse: (run: () => Promise<void>) => {
      runs.push(run);
    },
    runs,
    flush: async () => {
      for (const run of runs.splice(0)) {
        await run();
      }
    },
  };
}

describe.each(adapters)('%s adapter: post-response work', (_name, call) => {
  it('runs deferred tasks after the response, in order, one at a time', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { scheduleAfterResponse, runs } = seam();
    const status = await call(
      {
        ...baseStages,
        loadResources: (ctx: any) => {
          ctx.defer(async () => {
            events.push('refresh:start');
            await firstGate;
            events.push('refresh:end');
          });
          return {};
        },
        execute: (ctx: any) => {
          ctx.defer(() => {
            events.push('audit');
          });
          events.push('execute');
          return { ok: true };
        },
      },
      { scheduleAfterResponse }
    );
    expect(status).toBe(200);
    // Nothing ran during the request.
    expect(events).toEqual(['execute']);
    expect(runs).toHaveLength(1);
    const running = runs[0]();
    await new Promise((r) => setTimeout(r, 5));
    // Sequential: the second task waits for the first to settle.
    expect(events).toEqual(['execute', 'refresh:start']);
    releaseFirst();
    await running;
    expect(events).toEqual([
      'execute',
      'refresh:start',
      'refresh:end',
      'audit',
    ]);
  });

  it('routes a failing task to onError (phase defer) and keeps going', async () => {
    const seen: Array<[unknown, OnErrorInfo]> = [];
    const boom = new Error('audit write failed');
    const after = vi.fn();
    const { scheduleAfterResponse, flush } = seam();
    const status = await call(
      {
        ...baseStages,
        execute: (ctx: any) => {
          ctx.defer(() => {
            throw boom;
          });
          ctx.defer(async () => {
            throw new Error('async too');
          });
          ctx.defer(after);
          return { ok: true };
        },
      },
      {
        scheduleAfterResponse,
        onError: (error, info) => {
          seen.push([error, info]);
        },
      }
    );
    expect(status).toBe(200);
    await flush();
    expect(seen.map(([, info]) => info.phase)).toEqual(['defer', 'defer']);
    expect(seen[0][0]).toBe(boom);
    expect(seen[0][1].raw).toBeDefined();
    expect(after).toHaveBeenCalledOnce();
  });

  it('drops deferred tasks when the request fails; finally still runs', async () => {
    const task = vi.fn();
    const infos: FinallyInfo[] = [];
    const { scheduleAfterResponse, flush } = seam();
    const status = await call(
      {
        ...baseStages,
        loadResources: (ctx: any) => {
          ctx.defer(task);
          return {};
        },
        finalAuthorize: () => false,
      },
      { scheduleAfterResponse, finally: (info) => void infos.push(info) }
    );
    expect(status).toBe(403);
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({ outcome: 'error', status: 403 });
    expect(infos[0].error).toBeInstanceOf(HipForbidden);
  });

  it('finally runs once, last, after deferred tasks and afterResponse', async () => {
    const order: string[] = [];
    const { scheduleAfterResponse, flush } = seam();
    await call(
      {
        ...baseStages,
        execute: (ctx: any) => {
          ctx.defer(async () => {
            order.push('deferred');
          });
          return { ok: true };
        },
      },
      {
        scheduleAfterResponse,
        afterResponse: () => void order.push('afterResponse'),
        finally: (info) => {
          order.push(`finally:${info.outcome}:${info.status}`);
        },
      }
    );
    await flush();
    expect(order).toEqual(['deferred', 'afterResponse', 'finally:success:200']);
  });

  it('finally sees every outcome: 304, redirect, HipError, unexpected 500', async () => {
    const infos: FinallyInfo[] = [];
    const options = () => {
      const s = seam();
      return {
        s,
        options: {
          scheduleAfterResponse: s.scheduleAfterResponse,
          finally: (info: FinallyInfo) => void infos.push(info),
        },
      };
    };

    const notModified = options();
    const deferredOn304 = vi.fn();
    const afterResponseOn304 = vi.fn();
    expect(
      await call(
        {
          ...baseStages,
          loadResources: (ctx: any) => {
            ctx.defer(deferredOn304);
            return {};
          },
          etag: () => 'v1',
        },
        { ...notModified.options, afterResponse: afterResponseOn304 },
        { headers: { 'if-none-match': '"v1"' } }
      )
    ).toBe(304);
    await notModified.s.flush();
    // A 304 is a success: deferred tasks and afterResponse run too.
    expect(deferredOn304).toHaveBeenCalledOnce();
    expect(afterResponseOn304).toHaveBeenCalledOnce();

    const redirect = options();
    expect(
      await call(
        {
          ...baseStages,
          execute: () => {
            throw new HipRedirect('http://localhost/elsewhere', 303);
          },
        },
        redirect.options
      )
    ).toBe(303);
    await redirect.s.flush();

    const hipError = options();
    expect(
      await call(
        {
          ...baseStages,
          finalAuthorize: () => false,
        },
        hipError.options
      )
    ).toBe(403);
    await hipError.s.flush();

    const crash = options();
    const boom = new Error('db down');
    expect(
      await call(
        {
          ...baseStages,
          execute: () => {
            throw boom;
          },
        },
        crash.options
      )
    ).toBe(500);
    await crash.s.flush();

    expect(infos.map((i) => [i.outcome, i.status])).toEqual([
      ['not-modified', 304],
      ['redirect', 303],
      ['error', 403],
      ['error', 500],
    ]);
    expect(isHipError(infos[3].error)).toBe(true);
    expect((infos[3].error as Error).cause).toBe(boom);
  });

  it('a throwing finally is routed to onError (phase finally)', async () => {
    const phases: OnErrorInfo['phase'][] = [];
    const { scheduleAfterResponse, flush } = seam();
    await call(baseStages, {
      scheduleAfterResponse,
      finally: () => {
        throw new Error('flush failed');
      },
      onError: (_e, info) => void phases.push(info.phase),
    });
    await flush();
    expect(phases).toEqual(['finally']);
  });

  it('schedules nothing when there is nothing to run', async () => {
    const { scheduleAfterResponse, runs } = seam();
    await call(baseStages, { scheduleAfterResponse });
    expect(runs).toHaveLength(0);
  });

  it('the default scheduler runs the work after the response', async () => {
    let finished: FinallyInfo | undefined;
    const task = vi.fn();
    const status = await call(
      {
        ...baseStages,
        execute: (ctx: any) => {
          ctx.defer(task);
          return { ok: true };
        },
      },
      {
        finally: (info) => {
          finished = info;
        },
      }
    );
    expect(status).toBe(200);
    await vi.waitFor(() => expect(finished).toBeDefined());
    expect(task).toHaveBeenCalledOnce();
    expect(finished).toMatchObject({ outcome: 'success', status: 200 });
  });
});

describe('express: finally under delegateErrors', () => {
  it('reports the status your error middleware actually sent', async () => {
    let finished: FinallyInfo | undefined;
    const app = express();
    app.get(
      '/x',
      toExpressHandler({ ...baseStages, finalAuthorize: () => false } as any, {
        delegateErrors: true,
        finally: (info) => {
          finished = info;
        },
      })
    );
    app.use(
      (
        _err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(418).json({ error: 'teapot' });
      }
    );
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/x`);
      expect(res.status).toBe(418);
      await vi.waitFor(() => expect(finished).toBeDefined());
      expect(finished).toMatchObject({ outcome: 'error', status: 418 });
      expect(finished!.error).toBeInstanceOf(HipForbidden);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('tRPC: post-response work', () => {
  it('runs deferred tasks after the procedure resolves, then finally', async () => {
    const order: string[] = [];
    const { scheduleAfterResponse, flush } = seam();
    const procedure = toTrpcProcedure(
      {
        ...baseStages,
        execute: (ctx: any) => {
          ctx.defer(() => void order.push('deferred'));
          return { ok: true };
        },
      },
      {
        scheduleAfterResponse,
        finally: (info) => void order.push(`finally:${info.outcome}`),
      }
    );
    expect(await procedure({ ctx: {}, input: {} })).toEqual({ ok: true });
    expect(order).toEqual([]);
    await flush();
    expect(order).toEqual(['deferred', 'finally:success']);
  });

  it('drops deferred tasks on failure, runs finally, rethrows', async () => {
    const task = vi.fn();
    const infos: FinallyInfo[] = [];
    const { scheduleAfterResponse, flush } = seam();
    const procedure = toTrpcProcedure(
      {
        ...baseStages,
        loadResources: (ctx: any) => {
          ctx.defer(task);
          return {};
        },
        finalAuthorize: () => false,
      },
      { scheduleAfterResponse, finally: (info) => void infos.push(info) }
    );
    await expect(procedure({ ctx: {}, input: {} })).rejects.toBeInstanceOf(
      HipForbidden
    );
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(infos[0].outcome).toBe('error');
    expect(infos[0].status).toBeUndefined();
  });

  it('routes a failing task to onError and defaults to a later task', async () => {
    const phases: OnErrorInfo['phase'][] = [];
    const procedure = toTrpcProcedure(
      {
        ...baseStages,
        execute: (ctx: any) => {
          ctx.defer(() => {
            throw new Error('nope');
          });
          return { ok: true };
        },
      },
      { onError: (_e, info) => void phases.push(info.phase) }
    );
    await procedure({ ctx: {}, input: {} });
    expect(phases).toEqual([]);
    await vi.waitFor(() => expect(phases).toEqual(['defer']));
  });
});
