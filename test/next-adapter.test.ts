import { describe, it, expect, vi } from 'vitest';
import { hipNextHandlerFactory } from '../src/next';
import { defineHandler } from '../src/adapter';
import { HipError, HipRedirectException } from '../src/core';

// Minimal NextRequest mock
function mockNextRequest(options: { method?: string; url?: string; body?: any } = {}) {
  const url = new URL(options.url || 'http://localhost:3000/api/test');
  const req = {
    method: options.method || 'POST',
    nextUrl: { searchParams: url.searchParams },
    json: vi.fn().mockResolvedValue(options.body || {}),
  } as any;
  return req;
}

function mockRouteContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe('hipNextHandlerFactory', () => {
  it('returns a function', () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    expect(nextHandler).toBeTypeOf('function');
  });

  it('returns NextResponse with correct status and JSON body', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { message: 'hello' }, status: 201 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest();
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.message).toBe('hello');
  });

  it('extracts route params from routeContext', async () => {
    const handler = defineHandler({
      sanitizeParams: (p: any) => p,
      preAuthorize: (ctx: any) => {
        expect(ctx.params.id).toBe('42');
        return true;
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest();
    const ctx = mockRouteContext({ id: '42' });

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(200);
  });

  it('extracts query params from URL searchParams', async () => {
    const handler = defineHandler({
      sanitizeQueryParams: (q: any) => q,
      preAuthorize: (ctx: any) => {
        expect(ctx.queryParams.sort).toBe('asc');
        return true;
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest({ url: 'http://localhost:3000/api/test?sort=asc' });
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(200);
  });

  it('parses JSON body for POST requests', async () => {
    const handler = defineHandler({
      sanitizeBody: (b: any) => b,
      preAuthorize: (ctx: any) => {
        expect(ctx.body.name).toBe('test');
        return true;
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest({ method: 'POST', body: { name: 'test' } });
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(200);
    expect(req.json).toHaveBeenCalled();
  });

  it('skips body parsing for GET requests', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest({ method: 'GET' });
    const ctx = mockRouteContext();

    await nextHandler(req, ctx);
    expect(req.json).not.toHaveBeenCalled();
  });

  it('returns error JSON on HipError', async () => {
    const handler = defineHandler({
      preAuthorize: () => false,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest();
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it('returns custom HipError status and message', async () => {
    const handler = defineHandler({
      preAuthorize: () => {
        throw new HipError(401, 'Please sign in');
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest();
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Please sign in');
  });

  it('returns 500 for unexpected errors', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      doWork: () => { throw new Error('unexpected crash'); },
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest();
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Uncaught exception');
  });

  it('calls gatherContext and merges into unsafe', async () => {
    const handler = defineHandler({
      initPreContext: (unsafe: any) => ({ clerkUserId: unsafe.clerkUserId }),
      preAuthorize: (ctx: any) => {
        expect(ctx.preContext.clerkUserId).toBe('user-abc');
        return true;
      },
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any, {
      gatherContext: async () => ({ clerkUserId: 'user-abc' }),
    });
    const req = mockNextRequest();
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(200);
  });

  it('redirects on HipRedirectException', async () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      doWork: () => { throw new HipRedirectException('http://localhost:3000/login', 302); },
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const nextHandler = hipNextHandlerFactory(handler as any);
    const req = mockNextRequest();
    const ctx = mockRouteContext();

    const response = await nextHandler(req, ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('login');
  });
});
