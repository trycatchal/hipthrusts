// Conditional GET: the If-None-Match / entity-tag helpers, the lifecycle's
// etag stage, and every HTTP adapter's 304 / 200 + ETag handling.
import express from 'express';
import fastify from 'fastify';
import { Hono } from 'hono';
import { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { executeHipthrustable, withDefaultImplementations } from '../src/core';
import { HipForbidden, HipInternal, HipNotFound } from '../src/errors';
import { toExpressHandler } from '../src/express';
import { toFastifyHandler } from '../src/fastify';
import { toHonoHandler } from '../src/hono';
import {
  formatETag,
  httpLifecycleOptions,
  ifNoneMatchMatches,
  responseHeaders,
} from '../src/http-adapter';
import { toNextHandler } from '../src/next';
import { toTrpcProcedure } from '../src/trpc';

describe('formatETag', () => {
  it('quotes a bare value as a strong tag', () => {
    expect(formatETag('abc-1')).toBe('"abc-1"');
    expect(formatETag({ value: 'abc-1' })).toBe('"abc-1"');
  });

  it('prefixes W/ for a weak tag', () => {
    expect(formatETag({ value: 'abc', weak: true })).toBe('W/"abc"');
  });

  it('allows an empty tag and the full etagc range', () => {
    expect(formatETag('')).toBe('""');
    expect(formatETag('a,b!#~\x80\xff')).toBe('"a,b!#~\x80\xff"');
  });

  it.each(['"abc"', 'a b', 'a\r\nSet-Cookie: x=1', 'tab\there', '\x7f'])(
    'rejects %j (quotes, whitespace, controls) as a server bug',
    (value) => {
      expect(() => formatETag(value)).toThrow(HipInternal);
      expect(() => formatETag({ value })).toThrow(HipInternal);
    }
  );
});

describe('ifNoneMatchMatches (RFC 9110 §13.1.2)', () => {
  it('matches the same strong tag', () => {
    expect(ifNoneMatchMatches('"v1"', '"v1"')).toBe(true);
    expect(ifNoneMatchMatches('"v1"', '"v2"')).toBe(false);
  });

  it('uses weak comparison: W/ is ignored on both sides', () => {
    expect(ifNoneMatchMatches('W/"v1"', '"v1"')).toBe(true);
    expect(ifNoneMatchMatches('"v1"', 'W/"v1"')).toBe(true);
    expect(ifNoneMatchMatches('W/"v1"', 'W/"v1"')).toBe(true);
  });

  it('matches any member of a comma-separated list', () => {
    expect(ifNoneMatchMatches('"a", "b" ,W/"c"', '"c"')).toBe(true);
    expect(ifNoneMatchMatches('"a","b"', '"b"')).toBe(true);
    expect(ifNoneMatchMatches('"a", "b"', '"c"')).toBe(false);
  });

  it('does not split inside a quoted tag containing a comma', () => {
    expect(ifNoneMatchMatches('"a,b"', '"a,b"')).toBe(true);
    expect(ifNoneMatchMatches('"a,b"', '"a"')).toBe(false);
    expect(ifNoneMatchMatches('"a,b"', '"b"')).toBe(false);
  });

  it('`*` matches any current representation', () => {
    expect(ifNoneMatchMatches('*', '"anything"')).toBe(true);
    expect(ifNoneMatchMatches(' * ', 'W/"x"')).toBe(true);
  });

  it('skips malformed members and keeps scanning', () => {
    expect(ifNoneMatchMatches('v1', '"v1"')).toBe(false);
    expect(ifNoneMatchMatches('garbage, "v1"', '"v1"')).toBe(true);
    expect(ifNoneMatchMatches('"unterminated', '"unterminated"')).toBe(false);
  });

  it('accepts a repeated header (array) and handles absence', () => {
    expect(ifNoneMatchMatches(['"a"', '"b"'], '"b"')).toBe(true);
    expect(ifNoneMatchMatches(undefined, '"b"')).toBe(false);
    expect(ifNoneMatchMatches(null, '"b"')).toBe(false);
    expect(ifNoneMatchMatches('', '"b"')).toBe(false);
  });
});

describe('httpLifecycleOptions', () => {
  it('only enables the etag stage for GET and HEAD', () => {
    expect(httpLifecycleOptions('GET', {}).resolveETag).toBeTypeOf('function');
    expect(httpLifecycleOptions('head', {}).resolveETag).toBeTypeOf('function');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', undefined]) {
      expect(httpLifecycleOptions(method, {}).resolveETag).toBeUndefined();
    }
  });

  it('formats the tag and compares it to If-None-Match', () => {
    const { resolveETag } = httpLifecycleOptions('GET', {
      'if-none-match': 'W/"v1"',
    });
    expect(resolveETag!('v1')).toEqual({ etag: '"v1"', notModified: true });
    expect(resolveETag!({ value: 'v2', weak: true })).toEqual({
      etag: 'W/"v2"',
      notModified: false,
    });
  });
});

describe('responseHeaders', () => {
  it('adds the ETag, which wins over a hand-set one (any case)', () => {
    expect(
      responseHeaders({ 'Cache-Control': 'no-cache', etag: '"x"' }, '"v1"')
    ).toEqual({ 'Cache-Control': 'no-cache', ETag: '"v1"' });
  });

  it('leaves responseMeta headers alone without an etag', () => {
    expect(responseHeaders({ ETag: '"mine"' }, undefined)).toEqual({
      ETag: '"mine"',
    });
    expect(responseHeaders(undefined, undefined)).toEqual({});
  });
});

// One handler shape used across the adapters: a cheap header load, an etag
// from it, and an expensive execute that must be skipped on a match.
function conditionalHandler(
  opts: {
    tag?: string | null | { value: string; weak?: boolean };
    allow?: boolean;
    found?: boolean;
  } = {}
) {
  const execute = vi.fn(() => ({ cube: 'big', secret: 's' }));
  const redactResponse = vi.fn((u: { cube: string; secret: string }) => ({
    cube: u.cube,
  }));
  const etag = vi.fn(() => ('tag' in opts ? opts.tag : 'v1'));
  const handler = {
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    loadResources: () => {
      if (opts.found === false) {
        throw new HipNotFound();
      }
      return { header: { version: 1 } };
    },
    finalAuthorize: () => opts.allow !== false,
    etag,
    execute,
    redactResponse,
    responseMeta: { headers: { 'Cache-Control': 'private, no-cache' } },
  };
  return { handler, execute, redactResponse, etag };
}

describe('executeHipthrustable etag stage', () => {
  const full = (h: Record<string, unknown>) =>
    withDefaultImplementations(h as any);

  it('runs after finalAuthorize with its contributions, before execute', async () => {
    const order: string[] = [];
    const etag = vi.fn((ctx: any) => {
      order.push('etag');
      expect(ctx.role).toBe('reader');
      expect(ctx.doc).toEqual({ v: 3 });
      return `v${ctx.doc.v}`;
    });
    const result = await executeHipthrustable(
      full({
        sanitizeInputs: (i: any) => i,
        preAuthorize: () => true,
        loadResources: () => ({ doc: { v: 3 } }),
        finalAuthorize: () => {
          order.push('finalAuthorize');
          return { role: 'reader' };
        },
        etag,
        execute: () => {
          order.push('execute');
          return { ok: true };
        },
        redactResponse: (u: any) => u,
      }) as any,
      {},
      { resolveETag: (tag) => ({ etag: formatETag(tag), notModified: false }) }
    );
    expect(order).toEqual(['finalAuthorize', 'etag', 'execute']);
    expect(result).toMatchObject({
      notModified: false,
      etag: '"v3"',
      response: { ok: true },
    });
  });

  it('a match skips execute and redactResponse', async () => {
    const { handler, execute, redactResponse } = conditionalHandler();
    const result = await executeHipthrustable(
      full(handler) as any,
      {},
      {
        resolveETag: (tag) => ({ etag: formatETag(tag), notModified: true }),
      }
    );
    expect(result.notModified).toBe(true);
    expect(result.response).toBeUndefined();
    expect(result.etag).toBe('"v1"');
    expect(result.context.header).toEqual({ version: 1 });
    expect(result.context).not.toHaveProperty('response');
    expect(execute).not.toHaveBeenCalled();
    expect(redactResponse).not.toHaveBeenCalled();
  });

  it('null means "no validator": run normally, no etag', async () => {
    const { handler, execute } = conditionalHandler({ tag: null });
    const resolveETag = vi.fn();
    const result = await executeHipthrustable(
      full(handler) as any,
      {},
      {
        resolveETag,
      }
    );
    expect(resolveETag).not.toHaveBeenCalled();
    expect(result).toMatchObject({ notModified: false, etag: undefined });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('is not run at all without resolveETag (tRPC, non-GET)', async () => {
    const { handler, etag, execute } = conditionalHandler();
    const result = await executeHipthrustable(full(handler) as any, {});
    expect(etag).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(result.etag).toBeUndefined();
  });

  it('a denied caller never reaches the etag stage', async () => {
    const { handler, etag } = conditionalHandler({ allow: false });
    await expect(
      executeHipthrustable(
        full(handler) as any,
        {},
        {
          resolveETag: () => ({ etag: '"v1"', notModified: true }),
        }
      )
    ).rejects.toBeInstanceOf(HipForbidden);
    expect(etag).not.toHaveBeenCalled();
  });

  it('an unknown throw from the etag stage is a 500 with the cause chained', async () => {
    const boom = new Error('lease lookup failed');
    await expect(
      executeHipthrustable(
        full({
          ...conditionalHandler().handler,
          etag: () => {
            throw boom;
          },
        }) as any,
        {},
        { resolveETag: () => ({ etag: '"v1"', notModified: false }) }
      )
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof HipInternal && error.cause === boom
    );
  });
});

const GET_MATCH = { 'if-none-match': '"v1"' };

describe('Next adapter conditional GET', () => {
  const get = (headers: Record<string, string> = {}, method = 'GET') =>
    new NextRequest('http://localhost/api/rollup', { method, headers });

  it('answers a match with a bodiless 304 carrying ETag + responseMeta headers', async () => {
    const { handler, execute } = conditionalHandler();
    const res = await toNextHandler(handler)(get(GET_MATCH));
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"v1"');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(execute).not.toHaveBeenCalled();
  });

  it('adds the ETag to a 200 on a miss', async () => {
    const { handler, execute } = conditionalHandler();
    const res = await toNextHandler(handler)(
      get({ 'if-none-match': '"stale"' })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cube: 'big' });
    expect(res.headers.get('etag')).toBe('"v1"');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('formats a weak tag and matches it weakly', async () => {
    const { handler } = conditionalHandler({
      tag: { value: 'v1', weak: true },
    });
    const res = await toNextHandler(handler)(get(GET_MATCH));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('W/"v1"');
  });

  it('sends no ETag when the stage returns null', async () => {
    const { handler } = conditionalHandler({ tag: null });
    const res = await toNextHandler(handler)(get(GET_MATCH));
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeNull();
  });

  it('a denied caller gets 403, never 304', async () => {
    const { handler, etag } = conditionalHandler({ allow: false });
    const res = await toNextHandler(handler)(get(GET_MATCH));
    expect(res.status).toBe(403);
    expect(res.headers.get('etag')).toBeNull();
    expect(etag).not.toHaveBeenCalled();
  });

  it('a missing resource gets 404, never 304', async () => {
    const { handler, etag } = conditionalHandler({ found: false });
    const res = await toNextHandler(handler)(get(GET_MATCH));
    expect(res.status).toBe(404);
    expect(etag).not.toHaveBeenCalled();
  });

  it('handles HEAD like GET', async () => {
    const { handler } = conditionalHandler();
    const res = await toNextHandler(handler)(get(GET_MATCH, 'HEAD'));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"v1"');
  });

  it('ignores the etag stage for other methods', async () => {
    const { handler, etag, execute } = conditionalHandler();
    const res = await toNextHandler(handler)(
      new NextRequest('http://localhost/api/rollup', {
        method: 'POST',
        headers: GET_MATCH,
        body: '{}',
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeNull();
    expect(etag).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('an invalid tag is a 500', async () => {
    const { handler } = conditionalHandler({ tag: '"already-quoted"' });
    const res = await toNextHandler(handler)(get());
    expect(res.status).toBe(500);
  });
});

describe('Hono adapter conditional GET', () => {
  function app(handler: Record<string, unknown>) {
    const hono = new Hono();
    hono.get('/rollup', toHonoHandler(handler as any));
    return hono;
  }

  it('answers a match with a bodiless 304 carrying ETag + responseMeta headers', async () => {
    const { handler, execute } = conditionalHandler();
    const res = await app(handler).request('/rollup', { headers: GET_MATCH });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"v1"');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(execute).not.toHaveBeenCalled();
  });

  it('adds the ETag to a 200 on a miss', async () => {
    const { handler } = conditionalHandler();
    const res = await app(handler).request('/rollup');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cube: 'big' });
    expect(res.headers.get('etag')).toBe('"v1"');
  });

  it('a denied caller gets 403, never 304', async () => {
    const { handler, etag } = conditionalHandler({ allow: false });
    const res = await app(handler).request('/rollup', { headers: GET_MATCH });
    expect(res.status).toBe(403);
    expect(etag).not.toHaveBeenCalled();
  });

  it('handles HEAD like GET', async () => {
    const { handler } = conditionalHandler();
    const res = await app(handler).request('/rollup', {
      method: 'HEAD',
      headers: GET_MATCH,
    });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"v1"');
  });
});

describe('Express adapter conditional GET', () => {
  async function serve(handler: Record<string, unknown>) {
    const app = express();
    app.get('/rollup', toExpressHandler(handler as any));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}/rollup`,
      close: () =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('answers a match with a bodiless 304 carrying ETag + responseMeta headers', async () => {
    const { handler, execute } = conditionalHandler();
    const { url, close } = await serve(handler);
    try {
      const res = await fetch(url, { headers: GET_MATCH });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe('');
      expect(res.headers.get('etag')).toBe('"v1"');
      expect(res.headers.get('cache-control')).toBe('private, no-cache');
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('adds the ETag to a 200 on a miss', async () => {
    const { handler } = conditionalHandler();
    const { url, close } = await serve(handler);
    try {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cube: 'big' });
      expect(res.headers.get('etag')).toBe('"v1"');
    } finally {
      await close();
    }
  });

  it('a denied caller gets 403, never 304', async () => {
    const { handler, etag } = conditionalHandler({ allow: false });
    const { url, close } = await serve(handler);
    try {
      const res = await fetch(url, { headers: GET_MATCH });
      expect(res.status).toBe(403);
      expect(etag).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('handles HEAD like GET', async () => {
    const { handler } = conditionalHandler();
    const { url, close } = await serve(handler);
    try {
      const res = await fetch(url, { method: 'HEAD', headers: GET_MATCH });
      expect(res.status).toBe(304);
      expect(res.headers.get('etag')).toBe('"v1"');
    } finally {
      await close();
    }
  });
});

describe('Fastify adapter conditional GET', () => {
  function app(handler: Record<string, unknown>) {
    const instance = fastify();
    instance.get('/rollup', toFastifyHandler(handler as any));
    return instance;
  }

  it('answers a match with a bodiless 304 carrying ETag + responseMeta headers', async () => {
    const { handler, execute } = conditionalHandler();
    const res = await app(handler).inject({
      method: 'GET',
      url: '/rollup',
      headers: GET_MATCH,
    });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
    expect(res.headers.etag).toBe('"v1"');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(execute).not.toHaveBeenCalled();
  });

  it('adds the ETag to a 200 on a miss', async () => {
    const { handler } = conditionalHandler();
    const res = await app(handler).inject({ method: 'GET', url: '/rollup' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cube: 'big' });
    expect(res.headers.etag).toBe('"v1"');
  });

  it('a denied caller gets 403, never 304', async () => {
    const { handler, etag } = conditionalHandler({ allow: false });
    const res = await app(handler).inject({
      method: 'GET',
      url: '/rollup',
      headers: GET_MATCH,
    });
    expect(res.statusCode).toBe(403);
    expect(etag).not.toHaveBeenCalled();
  });

  it('handles HEAD like GET', async () => {
    const { handler } = conditionalHandler();
    const res = await app(handler).inject({
      method: 'HEAD',
      url: '/rollup',
      headers: GET_MATCH,
    });
    expect(res.statusCode).toBe(304);
    expect(res.headers.etag).toBe('"v1"');
  });
});

describe('tRPC ignores the etag stage', () => {
  it('never runs it and always executes', async () => {
    const { handler, etag, execute } = conditionalHandler();
    const procedure = toTrpcProcedure(handler);
    expect(await procedure({ ctx: {}, input: {} })).toEqual({ cube: 'big' });
    expect(etag).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });
});
