import { describe, it, expect, vi } from 'vitest';
import { hipHonoHandlerFactory } from '../src/hono';
import { defineHandler } from '../src/adapter';
import { HipError, HipRedirectException } from '../src/core';

function mockHonoContext(overrides: { params?: any; query?: any; body?: any; method?: string } = {}) {
  const c = {
    req: {
      param: () => overrides.params || {},
      query: () => overrides.query || {},
      json: vi.fn().mockResolvedValue(overrides.body || {}),
      method: overrides.method || 'POST',
    },
    json: vi.fn().mockImplementation((data, status) => ({ data, status })),
    redirect: vi.fn().mockImplementation((url, code) => ({ url, code })),
  } as any;
  return c;
}

describe('hipHonoHandlerFactory', () => {
  it('returns a function', () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const honoHandler = hipHonoHandlerFactory(handler as any);
    expect(honoHandler).toBeTypeOf('function');
  });

  it('calls c.json() on success', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { message: 'hi' }, status: 201 }),
      sanitizeResponse: (r: any) => r,
    });
    const honoHandler = hipHonoHandlerFactory(handler as any);
    const c = mockHonoContext();

    await honoHandler(c);

    expect(c.json).toHaveBeenCalledWith({ message: 'hi' }, 201);
  });

  it('skips body parsing for GET requests', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const honoHandler = hipHonoHandlerFactory(handler as any);
    const c = mockHonoContext({ method: 'GET' });

    await honoHandler(c);

    expect(c.req.json).not.toHaveBeenCalled();
  });

  it('returns error JSON on HipError', async () => {
    const handler = defineHandler({
      preAuthorize: () => false,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const honoHandler = hipHonoHandlerFactory(handler as any);
    const c = mockHonoContext();

    await honoHandler(c);

    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
      403
    );
  });

  it('redirects on HipRedirectException', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      doWork: () => { throw new HipRedirectException('/dashboard', 301); },
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const honoHandler = hipHonoHandlerFactory(handler as any);
    const c = mockHonoContext();

    await honoHandler(c);

    expect(c.redirect).toHaveBeenCalledWith('/dashboard', 301);
  });
});
