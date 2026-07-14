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
