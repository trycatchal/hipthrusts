import { describe, expect, it } from 'vitest';
import { HipForbidden, HipRedirect } from '../src/errors';
import { defineHonoHandler, toHonoHandler } from '../src/hono';

function fakeContext(opts: {
  method?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  bodyText?: string;
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
      text: async () => {
        if (opts.bodyText !== undefined) {
          return opts.bodyText;
        }
        return opts.body === undefined ? '' : JSON.stringify(opts.body);
      },
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

describe('hono adapter options (Findings P1-5, P2-12.2)', () => {
  const okStages = {
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: () => ({ ok: true }),
    redactResponse: (u: any) => u,
  };

  it('a malformed JSON body responds 422 by default', async () => {
    const handler = toHonoHandler(okStages, {});
    const c = fakeContext({ bodyText: '{not json' });
    await handler(c);
    expect(c.calls.json.status).toBe(422);
    expect(c.calls.json.body.error).toBe('Malformed JSON body');
  });

  it('allowMalformedBody restores the old coerce-to-{} behavior', async () => {
    const handler = toHonoHandler(okStages, { allowMalformedBody: true });
    const c = fakeContext({ bodyText: '{not json' });
    await handler(c);
    expect(c.calls.json.status).toBe(200);
  });

  it('onError fires with the converted error and a throwing hook is harmless', async () => {
    const seen: unknown[] = [];
    const boom = new Error('db down');
    const handler = toHonoHandler(
      {
        ...okStages,
        execute: () => {
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
    const c = fakeContext({ body: {} });
    await handler(c);
    expect(c.calls.json.status).toBe(500);
    expect((seen[0] as Error).cause).toBe(boom);
  });

  it('afterResponse receives the final context', async () => {
    let ctx: any;
    const handler = toHonoHandler(okStages, {
      afterResponse: (c2) => {
        ctx = c2;
      },
    });
    const c = fakeContext({ body: { x: 1 } });
    await handler(c);
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.response).toEqual({ ok: true });
    expect(ctx.inputs.body).toEqual({ x: 1 });
  });
});
