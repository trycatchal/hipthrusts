import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HTPipe } from '../src';
import { HipConflict, HipForbidden, HipRedirect } from '../src/errors';
import { htZodFactory } from '../src/zod';
import {
  defineNextHandler,
  makeNextHandlerFactory,
  toNextHandler,
} from '../src/next';

function postReq(url: string, body: any): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const routeCtx = (params: Record<string, string | string[]>) => ({
  params: Promise.resolve(params),
});

describe('defineNextHandler', () => {
  it('is an identity function', () => {
    const cfg = {
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    };
    expect(defineNextHandler(cfg as any)).toBe(cfg);
  });
});

describe('toNextHandler', () => {
  it('extracts params/query/body and returns JSON', async () => {
    const handler = toNextHandler({
      sanitizeInputs: (i: {
        params: { name: string };
        query: Record<string, string>;
        body: { times: number };
      }) => ({ name: i.params.name, q: i.query.loud, times: i.body.times }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: (ctx: {
        inputs: { name: string; q: string; times: number };
      }) => ({
        greeting: `hi ${ctx.inputs.name}`,
        loud: ctx.inputs.q,
        times: ctx.inputs.times,
      }),
      redactResponse: (u: any) => u,
      responseMeta: { status: 201 },
    });
    const res = await handler(
      postReq('http://localhost/api/greet?loud=yes', { times: 3 }),
      routeCtx({ name: 'sam' })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      greeting: 'hi sam',
      loud: 'yes',
      times: 3,
    });
  });

  it('merges gatherContext output into the raw envelope for extractAmbient', async () => {
    const handler = toNextHandler(
      {
        extractAmbient: (raw: { principal: string }) => ({
          principal: raw.principal,
        }),
        sanitizeInputs: (i: any) => i,
        preAuthorize: () => true,
        finalAuthorize: () => true,
        execute: (ctx: { ambient: { principal: string } }) => ({
          who: ctx.ambient.principal,
        }),
        redactResponse: (u: any) => u,
      },
      { gatherContext: async () => ({ principal: 'user-123' }) }
    );
    const res = await handler(
      postReq('http://localhost/api/me', {}),
      routeCtx({})
    );
    expect(await res.json()).toEqual({ who: 'user-123' });
  });

  it('maps a HipError to its status with an error body', async () => {
    const handler = toNextHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => {
        throw new HipForbidden('denied');
      },
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    });
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'denied' });
  });

  it('returns a 500 with the standard scrub message on an unexpected throw', async () => {
    const handler = toNextHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => {
        throw new Error('whoops');
      },
      redactResponse: (u: any) => u,
    });
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });

  it('issues a redirect on a HipRedirect', async () => {
    const handler = toNextHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => {
        throw new HipRedirect('http://localhost/login');
      },
      redactResponse: (u: any) => u,
    });
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toBe('http://localhost/login');
  });
});

describe('error detail on the wire (Finding P0-3)', () => {
  it('a zod sanitize failure responds 422 with issues (paths+messages only)', async () => {
    const { SanitizeInputsSlicesWithZod } = htZodFactory();
    const handler = toNextHandler(
      HTPipe(
        SanitizeInputsSlicesWithZod({ body: z.object({ name: z.string() }) }),
        {
          sanitizeInputs: (i: any) => i,
          preAuthorize: () => true,
          finalAuthorize: () => true,
          execute: () => ({}),
          redactResponse: (u: any) => u,
        }
      ) as any
    );
    const res = await handler(
      postReq('http://localhost/api/x', { name: 12345678901 }),
      routeCtx({})
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('body not valid');
    expect(body.issues[0].path).toEqual(['name']);
    expect(typeof body.issues[0].message).toBe('string');
    expect(JSON.stringify(body)).not.toContain('12345678901');
  });

  it('an exposed HipConflict detail reaches the client', async () => {
    const handler = toNextHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => {
        throw new HipConflict(
          'blocked',
          { blockedBy: ['a'] },
          { expose: true }
        );
      },
      redactResponse: (u: any) => u,
    });
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'blocked',
      detail: { blockedBy: ['a'] },
    });
  });
});

describe('adapter options (Findings P1-5, P1-6, P2-12.2)', () => {
  const okStages = {
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    loadResources: () => ({ thing: { id: 't1' } }),
    finalAuthorize: () => true,
    execute: () => ({ made: true }),
    redactResponse: (u: any) => u,
  };

  it('onError receives the original error (via cause) on a 500 path', async () => {
    const seen: unknown[] = [];
    const dbDown = new Error('db down');
    const handler = toNextHandler(
      {
        ...okStages,
        loadResources: () => {
          throw dbDown;
        },
      },
      { onError: (e) => seen.push(e) }
    );
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(500);
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).cause).toBe(dbDown);
  });

  it('a throwing onError does not change the response', async () => {
    const handler = toNextHandler(
      {
        ...okStages,
        execute: () => {
          throw new Error('boom');
        },
      },
      {
        onError: () => {
          throw new Error('logging is broken too');
        },
      }
    );
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });

  it('afterResponse receives the final context (inputs, resources, response)', async () => {
    let ctx: any;
    const handler = toNextHandler(okStages, {
      afterResponse: (c) => {
        ctx = c;
      },
    });
    const res = await handler(
      postReq('http://localhost/api/x?q=1', { name: 'n' }),
      routeCtx({ id: '9' })
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx).toBeDefined();
    expect(ctx.inputs.body).toEqual({ name: 'n' });
    expect(ctx.inputs.params).toEqual({ id: '9' });
    expect(ctx.thing).toEqual({ id: 't1' });
    expect(ctx.response).toEqual({ made: true });
  });

  it('routes afterResponse failures (sync and async) to onError with phase afterResponse', async () => {
    const seen: { error: unknown; info: any }[] = [];
    const syncThrower = toNextHandler(okStages, {
      onError: (error, info) => seen.push({ error, info }),
      afterResponse: () => {
        throw new Error('audit write failed');
      },
    });
    const res = await syncThrower(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    expect((seen[0].error as Error).message).toBe('audit write failed');
    expect(seen[0].info.phase).toBe('afterResponse');

    seen.length = 0;
    const asyncRejector = toNextHandler(okStages, {
      onError: (error, info) => seen.push({ error, info }),
      afterResponse: async () => {
        throw new Error('async audit write failed');
      },
    });
    const res2 = await asyncRejector(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res2.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    expect((seen[0].error as Error).message).toBe('async audit write failed');
    expect(seen[0].info.phase).toBe('afterResponse');
  });

  it('request-lifecycle onError calls carry no afterResponse phase', async () => {
    const seen: any[] = [];
    const handler = toNextHandler(
      {
        ...okStages,
        execute: () => {
          throw new Error('boom');
        },
      },
      { onError: (_e, info) => seen.push(info) }
    );
    await handler(postReq('http://localhost/api/x', {}), routeCtx({}));
    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBeUndefined();
  });

  it('makeNextHandlerFactory bakes defaults; per-call options merge over them', async () => {
    const gathered: string[] = [];
    const toAppHandler = makeNextHandlerFactory({
      gatherContext: async () => {
        gathered.push('default');
        return { principal: 'default-user' };
      },
    });

    const withDefaults = toAppHandler({
      extractAmbient: (raw: { principal: string }) => ({
        principal: raw.principal,
      }),
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: (ctx: { ambient: { principal: string } }) => ({
        who: ctx.ambient.principal,
      }),
      redactResponse: (u: any) => u,
    });
    const res = await withDefaults(
      postReq('http://localhost/api/me', {}),
      routeCtx({})
    );
    expect(await res.json()).toEqual({ who: 'default-user' });
    expect(gathered).toEqual(['default']);

    const overridden = toAppHandler(
      {
        extractAmbient: (raw: { principal: string }) => ({
          principal: raw.principal,
        }),
        sanitizeInputs: (i: any) => i,
        preAuthorize: () => true,
        finalAuthorize: () => true,
        execute: (ctx: { ambient: { principal: string } }) => ({
          who: ctx.ambient.principal,
        }),
        redactResponse: (u: any) => u,
      },
      { gatherContext: async () => ({ principal: 'override-user' }) }
    );
    const res2 = await overridden(
      postReq('http://localhost/api/me', {}),
      routeCtx({})
    );
    expect(await res2.json()).toEqual({ who: 'override-user' });
  });

  it('afterResponse does not fire on a failed request', async () => {
    let fired = false;
    const handler = toNextHandler(
      {
        ...okStages,
        finalAuthorize: () => false,
      },
      {
        afterResponse: () => {
          fired = true;
        },
      }
    );
    const res = await handler(
      postReq('http://localhost/api/x', {}),
      routeCtx({})
    );
    expect(res.status).toBe(403);
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(false);
  });

  it('a malformed JSON body responds 422 by default', async () => {
    const handler = toNextHandler(okStages);
    const res = await handler(
      new NextRequest('http://localhost/api/x', {
        method: 'POST',
        body: '{not json',
        headers: { 'content-type': 'application/json' },
      }),
      routeCtx({})
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Malformed JSON body');
  });

  it('allowMalformedBody restores coerce-to-{} and an empty body still passes', async () => {
    const seenBodies: any[] = [];
    const strategy = {
      ...okStages,
      sanitizeInputs: (i: any) => {
        seenBodies.push(i.body);
        return i;
      },
    };
    const lenient = toNextHandler(strategy, { allowMalformedBody: true });
    const malformed = await lenient(
      new NextRequest('http://localhost/api/x', {
        method: 'POST',
        body: '{not json',
        headers: { 'content-type': 'application/json' },
      }),
      routeCtx({})
    );
    expect(malformed.status).toBe(200);
    const strict = toNextHandler(strategy);
    const empty = await strict(
      new NextRequest('http://localhost/api/x', { method: 'POST' }),
      routeCtx({})
    );
    expect(empty.status).toBe(200);
    expect(seenBodies).toEqual([{}, {}]);
  });
});
