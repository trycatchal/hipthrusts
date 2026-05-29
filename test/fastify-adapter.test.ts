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
