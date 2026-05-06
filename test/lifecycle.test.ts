import { describe, it, expect } from 'vitest';
import {
  executeHipthrustable,
  HipError,
  HipRedirectException,
  withDefaultImplementations,
} from '../src/core';
import { defineHandler } from '../src/adapter';

function makeHandler(overrides: Record<string, any> = {}) {
  return withDefaultImplementations(
    defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { success: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
      ...overrides,
    }) as any
  );
}

describe('executeHipthrustable', () => {
  it('runs the full lifecycle and returns response', async () => {
    const handler = makeHandler();
    const result = await executeHipthrustable(handler, {}, {}, {}, {});
    expect(result.status).toBe(200);
  });

  it('threads context from preAuthorize → attachData → doWork → respond', async () => {
    const handler = makeHandler({
      preAuthorize: () => ({ userId: '123' }),
      attachData: (ctx: any) => {
        expect(ctx.userId).toBe('123');
        return { userName: 'Alice' };
      },
      finalAuthorize: (ctx: any) => {
        expect(ctx.userId).toBe('123');
        expect(ctx.userName).toBe('Alice');
        return true;
      },
      doWork: (ctx: any) => {
        expect(ctx.userId).toBe('123');
        expect(ctx.userName).toBe('Alice');
        return { result: 'done' };
      },
      respond: (ctx: any) => ({
        unsafeResponse: { user: ctx.userName, result: ctx.result },
        status: 201,
      }),
      sanitizeResponse: (r: any) => r,
    });
    const result = await executeHipthrustable(handler, {}, {}, {}, {});
    expect(result.status).toBe(201);
  });

  describe('error handling', () => {
    it('throws HipError(422) when sanitizeParams fails', async () => {
      const handler = makeHandler({
        sanitizeParams: () => { throw new Error('bad'); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 422
      );
    });

    it('throws HipError(422) when sanitizeBody fails', async () => {
      const handler = makeHandler({
        sanitizeBody: () => { throw new Error('bad'); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 422
      );
    });

    it('throws HipError(403) when preAuthorize returns false', async () => {
      const handler = makeHandler({ preAuthorize: () => false });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 403
      );
    });

    it('throws HipError(404) when attachData throws', async () => {
      const handler = makeHandler({
        attachData: () => { throw new Error('missing'); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 404
      );
    });

    it('throws HipError(403) when finalAuthorize returns false', async () => {
      const handler = makeHandler({ finalAuthorize: () => false });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 403
      );
    });

    it('throws HipError(500) when doWork throws a non-HipError', async () => {
      const handler = makeHandler({
        doWork: () => { throw new Error('oops'); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 500
      );
    });

    it('passes through HipError thrown from any stage', async () => {
      const handler = makeHandler({
        doWork: () => { throw new HipError(409, 'Conflict'); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 409 && err.message === 'Conflict'
      );
    });

    it('passes through HipError thrown from attachData', async () => {
      const handler = makeHandler({
        attachData: () => { throw new HipError(401, 'Unauthorized'); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toSatisfy((err: any) =>
        HipError.isHipError(err) && err.statusCode === 401
      );
    });

    it('passes through HipRedirectException', async () => {
      const handler = makeHandler({
        doWork: () => { throw new HipRedirectException('/login', 302); },
      });
      await expect(
        executeHipthrustable(handler, {}, {}, {}, {})
      ).rejects.toBeInstanceOf(HipRedirectException);
    });
  });
});
