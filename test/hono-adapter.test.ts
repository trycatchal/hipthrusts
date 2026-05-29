import { describe, expect, it } from 'vitest';
import { HipForbidden, HipRedirect } from '../src/errors';
import { defineHonoHandler, toHonoHandler } from '../src/hono';

function fakeContext(opts: {
  method?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
}): any {
  const calls: any = {};
  return {
    calls,
    req: {
      method: opts.method || 'POST',
      param: () => opts.params || {},
      query: () => opts.query || {},
      header: () => opts.headers || {},
      json: async () => {
        if (opts.body === undefined) {
          throw new Error('no body');
        }
        return opts.body;
      },
    },
    header(k: string, v: string) {
      calls.headers = calls.headers || {};
      calls.headers[k] = v;
    },
    json(body: any, status?: number) {
      calls.json = { body, status };
      return { body, status };
    },
    redirect(url: string, code?: number) {
      calls.redirect = { url, code };
      return { url, code };
    },
  };
}

describe('defineHonoHandler', () => {
  it('is an identity function', () => {
    const cfg = {
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    };
    expect(defineHonoHandler(cfg as any)).toBe(cfg);
  });
});

describe('toHonoHandler', () => {
  it('responds with JSON and a responseMeta status', async () => {
    const handler = toHonoHandler({
      sanitizeInputs: (i: { params: { name: string } }) => ({
        name: i.params.name,
      }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: (ctx: { inputs: { name: string } }) => ({
        greeting: `hi ${ctx.inputs.name}`,
      }),
      redactResponse: (u: any) => u,
      responseMeta: { status: 201 },
    });
    const c = fakeContext({ params: { name: 'sam' }, body: {} });
    await handler(c);
    expect(c.calls.json.body).toEqual({ greeting: 'hi sam' });
    expect(c.calls.json.status).toBe(201);
  });

  it('skips body parsing for GET requests', async () => {
    const handler = toHonoHandler({
      sanitizeInputs: (i: { body: any }) => ({ body: i.body }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: (ctx: { inputs: { body: any } }) => ctx.inputs,
      redactResponse: (u: any) => u,
    });
    const c = fakeContext({ method: 'GET' });
    await handler(c);
    expect(c.calls.json.body).toEqual({ body: {} });
  });

  it('maps a HipError to its status with an error body', async () => {
    const handler = toHonoHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => {
        throw new HipForbidden('denied');
      },
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    });
    const c = fakeContext({ body: {} });
    await handler(c);
    expect(c.calls.json.status).toBe(403);
    expect(c.calls.json.body).toEqual({ error: 'denied' });
  });

  it('redirects on a HipRedirect', async () => {
    const handler = toHonoHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => {
        throw new HipRedirect('/dashboard', 301);
      },
      redactResponse: (u: any) => u,
    });
    const c = fakeContext({ body: {} });
    await handler(c);
    expect(c.calls.redirect).toEqual({ url: '/dashboard', code: 301 });
  });
});
