import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HTPipe } from '../src';
import { HipConflict, HipForbidden, HipRedirect } from '../src/errors';
import { htZodFactory } from '../src/zod';
import { defineNextHandler, toNextHandler } from '../src/next';

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
    const { SanitizeInputsSliceWithZod } = htZodFactory();
    const handler = toNextHandler(
      HTPipe(
        SanitizeInputsSliceWithZod('body', z.object({ name: z.string() })),
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
