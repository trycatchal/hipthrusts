import { describe, expect, it, vi } from 'vitest';
import { HipForbidden, HipRedirect } from '../src/errors';
import { defineExpressHandler, toExpressHandler } from '../src/express';

function fakeRes(): any {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    redirectedTo: undefined as string | undefined,
    redirectCode: undefined as number | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    redirect(code: number, url: string) {
      this.redirectCode = code;
      this.redirectedTo = url;
    },
  };
}

const rawReq = (over: any = {}) => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  ...over,
});

describe('defineExpressHandler', () => {
  it('is an identity function (returns the same config object)', () => {
    const cfg = {
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    };
    expect(defineExpressHandler(cfg as any)).toBe(cfg);
  });
});

describe('toExpressHandler', () => {
  it('threads params/query/body into the lifecycle and responds with JSON', async () => {
    const handler = toExpressHandler({
      sanitizeInputs: (i: { params: { id: string }; body: { n: number } }) => ({
        id: i.params.id,
        n: i.body.n,
      }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: (ctx: { inputs: { id: string; n: number } }) => ({
        echoed: ctx.inputs,
      }),
      redactResponse: (u: any) => u,
    });
    const res = fakeRes();
    await handler(
      rawReq({ params: { id: 'abc' }, body: { n: 7 } }) as any,
      res,
      (() => undefined) as any
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ echoed: { id: 'abc', n: 7 } });
  });

  it('forwards a denied authorization to next as an error', async () => {
    const handler = toExpressHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => {
        throw new HipForbidden('nope');
      },
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    });
    const next = vi.fn();
    const res = fakeRes();
    await handler(rawReq() as any, res, next as any);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeDefined();
  });

  it('issues a redirect when a HipRedirect is thrown', async () => {
    const handler = toExpressHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => {
        throw new HipRedirect('/login');
      },
      redactResponse: (u: any) => u,
    });
    const res = fakeRes();
    await handler(rawReq() as any, res, (() => undefined) as any);
    expect(res.redirectedTo).toBe('/login');
    expect(res.redirectCode).toBe(302);
  });
});

describe('express adapter options (Findings P1-5, P1-6)', () => {
  const okStages = {
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: () => ({ ok: true }),
    redactResponse: (u: any) => u,
  };

  it('onError fires with the converted error before next() and a throwing hook is harmless', async () => {
    const seen: unknown[] = [];
    const boom = new Error('db down');
    const handler = toExpressHandler(
      {
        ...okStages,
        loadResources: () => {
          throw boom;
        },
      },
      {
        onError: (e) => {
          seen.push(e);
          throw new Error('broken logger');
        },
      }
    );
    const next = vi.fn();
    await handler(rawReq() as any, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((seen[0] as Error).cause).toBe(boom);
  });

  it('afterResponse fires on res finish with the final context', async () => {
    let ctx: any;
    const listeners: Record<string, () => void> = {};
    const res = fakeRes();
    res.on = (event: string, cb: () => void) => {
      listeners[event] = cb;
    };
    const handler = toExpressHandler(okStages, {
      afterResponse: (c) => {
        ctx = c;
      },
    });
    await handler(rawReq({ body: { x: 1 } }) as any, res, vi.fn());
    expect(ctx).toBeUndefined();
    listeners.finish();
    await new Promise((r) => setTimeout(r, 5));
    expect(ctx.response).toEqual({ ok: true });
    expect(ctx.inputs.body).toEqual({ x: 1 });
  });
});
