import { describe, it, expect, vi } from 'vitest';
import { hipFastifyHandlerFactory } from '../src/fastify';
import { defineHandler } from '../src/adapter';
import { HipError, HipRedirectException } from '../src/core';

function mockFastifyReqReply(overrides: { params?: any; query?: any; body?: any } = {}) {
  const req = {
    params: overrides.params || {},
    query: overrides.query || {},
    body: overrides.body || {},
  } as any;
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
  } as any;
  return { req, reply };
}

describe('hipFastifyHandlerFactory', () => {
  it('returns a function', () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const fastifyHandler = hipFastifyHandlerFactory(handler as any);
    expect(fastifyHandler).toBeTypeOf('function');
  });

  it('calls reply.status().send() on success', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { data: 'test' }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const fastifyHandler = hipFastifyHandlerFactory(handler as any);
    const { req, reply } = mockFastifyReqReply();

    await fastifyHandler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalled();
  });

  it('passes params, query, body to the lifecycle', async () => {
    const handler = defineHandler({
      sanitizeParams: (p: any) => p,
      sanitizeQueryParams: (q: any) => q,
      sanitizeBody: (b: any) => b,
      preAuthorize: (ctx: any) => {
        expect(ctx.params.id).toBe('99');
        expect(ctx.queryParams.page).toBe('2');
        expect(ctx.body.title).toBe('hello');
        return true;
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const fastifyHandler = hipFastifyHandlerFactory(handler as any);
    const { req, reply } = mockFastifyReqReply({
      params: { id: '99' },
      query: { page: '2' },
      body: { title: 'hello' },
    });

    await fastifyHandler(req, reply);
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it('returns error on HipError', async () => {
    const handler = defineHandler({
      preAuthorize: () => false,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const fastifyHandler = hipFastifyHandlerFactory(handler as any);
    const { req, reply } = mockFastifyReqReply();

    await fastifyHandler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('redirects on HipRedirectException', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      doWork: () => { throw new HipRedirectException('/home', 302); },
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const fastifyHandler = hipFastifyHandlerFactory(handler as any);
    const { req, reply } = mockFastifyReqReply();

    await fastifyHandler(req, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/home');
  });
});
