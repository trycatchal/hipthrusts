import { describe, it, expect, vi } from 'vitest';
import { hipExpressHandlerFactory } from '../src/express';
import { defineHandler } from '../src/adapter';
import { HipError } from '../src/core';

function mockReqResNext(overrides: { params?: any; query?: any; body?: any } = {}) {
  const req = {
    params: overrides.params || {},
    query: overrides.query || {},
    body: overrides.body || {},
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('hipExpressHandlerFactory', () => {
  it('returns a function', () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const middleware = hipExpressHandlerFactory(handler as any);
    expect(middleware).toBeTypeOf('function');
  });

  it('calls res.status().json() on success', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { message: 'hello' }, status: 201 }),
      sanitizeResponse: (r: any) => r,
    });
    const middleware = hipExpressHandlerFactory(handler as any);
    const { req, res, next } = mockReqResNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('passes params, query, body to the lifecycle', async () => {
    const handler = defineHandler({
      sanitizeParams: (p: any) => p,
      sanitizeQueryParams: (q: any) => q,
      sanitizeBody: (b: any) => b,
      preAuthorize: (ctx: any) => {
        expect(ctx.params.id).toBe('42');
        expect(ctx.queryParams.sort).toBe('asc');
        expect(ctx.body.name).toBe('test');
        return true;
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const middleware = hipExpressHandlerFactory(handler as any);
    const { req, res, next } = mockReqResNext({
      params: { id: '42' },
      query: { sort: 'asc' },
      body: { name: 'test' },
    });

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(error) when lifecycle throws', async () => {
    const handler = defineHandler({
      preAuthorize: () => false,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const middleware = hipExpressHandlerFactory(handler as any);
    const { req, res, next } = mockReqResNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(HipError.isHipError(next.mock.calls[0][0])).toBe(true);
  });

  it('calls res.redirect on HipRedirectException', async () => {
    const { HipRedirectException } = await import('../src/core');
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      doWork: () => { throw new HipRedirectException('/login', 302); },
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const middleware = hipExpressHandlerFactory(handler as any);
    const { req, res, next } = mockReqResNext();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, '/login');
    expect(next).not.toHaveBeenCalled();
  });
});
