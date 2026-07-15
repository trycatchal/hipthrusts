import { describe, expect, it } from 'vitest';
import { HipForbidden, HipRedirect } from '../src/errors';
import { defineFastifyHandler, toFastifyHandler } from '../src/fastify';

function fakeReply(): any {
  return {
    statusCode: 200,
    sent: undefined as any,
    headers: {} as Record<string, string>,
    redirectedTo: undefined as string | undefined,
    redirectCode: undefined as number | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: any) {
      this.sent = payload;
      return this;
    },
    header(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    redirect(url: string, code?: number) {
      this.redirectedTo = url;
      this.redirectCode = code;
    },
  };
}

const fakeReq = (over: any = {}) => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  ...over,
});

describe('defineFastifyHandler', () => {
  it('is an identity function', () => {
    const cfg = {
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    };
    expect(defineFastifyHandler(cfg as any)).toBe(cfg);
  });
});

describe('toFastifyHandler', () => {
  it('threads request data and sends JSON with a status', async () => {
    const handler = toFastifyHandler({
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
    const reply = fakeReply();
    await handler(fakeReq({ params: { name: 'sam' } }) as any, reply);
    expect(reply.statusCode).toBe(201);
    expect(reply.sent).toEqual({ greeting: 'hi sam' });
  });

  it('maps a HipError to its status with an error body', async () => {
    const handler = toFastifyHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => {
        throw new HipForbidden('denied');
      },
      finalAuthorize: () => true,
      execute: () => ({}),
      redactResponse: (u: any) => u,
    });
    const reply = fakeReply();
    await handler(fakeReq() as any, reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.sent).toEqual({ error: 'denied' });
  });

  it('redirects on a HipRedirect', async () => {
    const handler = toFastifyHandler({
      sanitizeInputs: (i: any) => i,
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: () => {
        throw new HipRedirect('/home');
      },
      redactResponse: (u: any) => u,
    });
    const reply = fakeReply();
    await handler(fakeReq() as any, reply);
    expect(reply.redirectedTo).toBe('/home');
  });
});

describe('fastify adapter options (Findings P1-5, P1-6)', () => {
  const okStages = {
    sanitizeInputs: (i: any) => i,
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: () => ({ ok: true }),
    redactResponse: (u: any) => u,
  };

  it('onError fires on the 500 path and a throwing hook is harmless', async () => {
    const seen: unknown[] = [];
    const boom = new Error('db down');
    const handler = toFastifyHandler(
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
    const reply = fakeReply();
    await handler(fakeReq() as any, reply);
    expect(reply.statusCode).toBe(500);
    expect((seen[0] as Error).cause).toBe(boom);
  });

  it('afterResponse receives the final context after the reply is sent', async () => {
    let ctx: any;
    const handler = toFastifyHandler(okStages, {
      afterResponse: (c) => {
        ctx = c;
      },
    });
    const reply = fakeReply();
    await handler(fakeReq({ body: { x: 1 } }) as any, reply);
    await new Promise((r) => setImmediate(r));
    expect(ctx.response).toEqual({ ok: true });
    expect(ctx.inputs.body).toEqual({ x: 1 });
  });
});
