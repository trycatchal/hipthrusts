import { describe, it } from 'vitest';
import { hipExpressHandlerFactory } from '../src';

/**
 * Compile-time type safety tests for hipExpressHandlerFactory.
 *
 * These tests verify that each lifecycle stage can only access data
 * that was produced by prior stages. The @ts-expect-error directives
 * ARE the assertions — if the code compiles without error where
 * @ts-expect-error is placed, the test fails (meaning TS didn't
 * catch a type violation it should have).
 */

// Minimal valid handler skeleton — used as a base for most tests
const minimalBase = {
  preAuthorize: () => ({}),
  finalAuthorize: () => true,
  respond: () => ({ unsafeResponse: {}, status: 200 as const }),
  sanitizeResponse: (r: any) => r,
};

describe('Type safety: lifecycle stage data flow', () => {
  // ─────────────────────────────────────────────────────────────────────
  // sanitizeParams
  // ─────────────────────────────────────────────────────────────────────
  describe('sanitizeParams', () => {
    it('happy: preAuthorize accesses params from sanitizeParams (immediate next)', () => {
      hipExpressHandlerFactory({
        sanitizeParams: () => ({ orgId: 'abc' }),
        preAuthorize: (ctx: { params: { orgId: string } }) => ({}),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: respond accesses params from sanitizeParams (way before)', () => {
      hipExpressHandlerFactory({
        sanitizeParams: () => ({ orgId: 'abc' }),
        preAuthorize: () => ({}),
        finalAuthorize: () => true,
        respond: (ctx: { params: { orgId: string } }) => ({ unsafeResponse: ctx.params }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: sanitizeParams provides extra keys beyond what preAuthorize needs', () => {
      hipExpressHandlerFactory({
        sanitizeParams: () => ({ orgId: 'abc', extra: 42 }),
        preAuthorize: (ctx: { params: { orgId: string } }) => ({}),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // sanitizeBody
  // ─────────────────────────────────────────────────────────────────────
  describe('sanitizeBody', () => {
    it('happy: preAuthorize accesses body from sanitizeBody (immediate next)', () => {
      hipExpressHandlerFactory({
        sanitizeBody: () => ({ name: 'test' }),
        preAuthorize: (ctx: { body: { name: string } }) => ({}),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: attachData accesses body from sanitizeBody (way before)', () => {
      hipExpressHandlerFactory({
        sanitizeBody: () => ({ name: 'test' }),
        preAuthorize: () => ({ userId: '1' }),
        attachData: (ctx: { body: { name: string } }) => ({ record: 'saved' }),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: sanitizeBody provides extra keys beyond what is needed', () => {
      hipExpressHandlerFactory({
        sanitizeBody: () => ({ name: 'test', age: 30, extra: true }),
        preAuthorize: (ctx: { body: { name: string } }) => ({}),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // sanitizeQueryParams
  // ─────────────────────────────────────────────────────────────────────
  describe('sanitizeQueryParams', () => {
    it('happy: preAuthorize accesses query from sanitizeQueryParams', () => {
      hipExpressHandlerFactory({
        sanitizeQueryParams: () => ({ page: 1 }),
        preAuthorize: (ctx: { query: { page: number } }) => ({}),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: respond accesses queryParams from sanitizeQueryParams (way before)', () => {
      hipExpressHandlerFactory({
        sanitizeQueryParams: () => ({ page: 1 }),
        preAuthorize: () => ({}),
        finalAuthorize: () => true,
        respond: (ctx: { queryParams: { page: number } }) => ({ unsafeResponse: { page: ctx.queryParams.page } }),
        sanitizeResponse: (r: any) => r,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // preAuthorize
  // ─────────────────────────────────────────────────────────────────────
  describe('preAuthorize', () => {
    it('happy: attachData accesses preAuthorize output (immediate next)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: respond accesses preAuthorize output (way before)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        finalAuthorize: () => true,
        respond: (ctx: { userId: string }) => ({ unsafeResponse: { id: ctx.userId } }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: preAuthorize provides extra keys beyond what attachData needs', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123', role: 'admin', orgId: 'org1' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
        finalAuthorize: () => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('sad: attachData requests a key not produced by any prior stage', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          attachData: (ctx: { nonExistent: string }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: attachData requests a key with wrong type', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          attachData: (ctx: { userId: number }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: attachData requests partially provided key (wants more than exists)', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          attachData: (ctx: { userId: string; orgId: string }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // attachData
  // ─────────────────────────────────────────────────────────────────────
  describe('attachData', () => {
    it('happy: finalAuthorize accesses attachData output (immediate next)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice', role: 'admin' } }),
        finalAuthorize: (ctx: { user: { name: string; role: string } }) => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: respond accesses attachData output (way before)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
        finalAuthorize: () => true,
        respond: (ctx: { user: { name: string } }) => ({ unsafeResponse: ctx.user }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: attachData provides extra keys beyond what finalAuthorize needs', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' }, org: { id: 'o1' }, extra: 99 }),
        finalAuthorize: (ctx: { user: { name: string } }) => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('sad: finalAuthorize requests a key not produced by any prior stage', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
          finalAuthorize: (ctx: { phantom: boolean }) => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: finalAuthorize requests a key with wrong type', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
          finalAuthorize: (ctx: { user: number }) => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: finalAuthorize requests partially provided key', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
          finalAuthorize: (ctx: { user: { name: string; age: number } }) => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // finalAuthorize
  // ─────────────────────────────────────────────────────────────────────
  describe('finalAuthorize', () => {
    it('happy: doWork accesses finalAuthorize output (immediate next)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
        finalAuthorize: (ctx: { user: { name: string } }) => ({ allowed: true }),
        doWork: (ctx: { allowed: boolean }) => ({}),
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: respond accesses data from preAuthorize (way before finalAuthorize)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123', tenantId: 'T1' }),
        finalAuthorize: () => true,
        respond: (ctx: { tenantId: string }) => ({ unsafeResponse: { t: ctx.tenantId } }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: finalAuthorize accesses data from sanitizeParams (way before)', () => {
      hipExpressHandlerFactory({
        sanitizeParams: () => ({ orgId: 'org1' }),
        preAuthorize: (ctx: { params: { orgId: string } }) => ({ userId: '1' }),
        attachData: (ctx: { userId: string }) => ({ org: { id: 'org1' } }),
        finalAuthorize: (ctx: { params: { orgId: string }; org: { id: string } }) => true,
        respond: () => ({ unsafeResponse: {} }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('sad: doWork requests a key not produced by any prior stage', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          finalAuthorize: () => true,
          doWork: (ctx: { ghost: string }) => ({}),
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: doWork requests a key with wrong type', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          finalAuthorize: () => true,
          doWork: (ctx: { userId: number }) => ({}),
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: doWork requests partially provided key', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({ userId: '123' }),
          finalAuthorize: () => true,
          doWork: (ctx: { userId: string; orgId: string }) => ({}),
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // doWork
  // ─────────────────────────────────────────────────────────────────────
  describe('doWork', () => {
    it('happy: respond accesses doWork output (immediate next)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        attachData: (ctx: { userId: string }) => ({ user: { name: 'Alice' } }),
        finalAuthorize: () => true,
        doWork: (ctx: { user: { name: string } }) => ({ result: 'done' }),
        respond: (ctx: any) => ({ unsafeResponse: { r: ctx.result }, status: 200 }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: respond accesses preAuthorize output (way before doWork)', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({ userId: '123' }),
        finalAuthorize: () => true,
        doWork: () => ({ result: 'done' }),
        respond: (ctx: any) => ({ unsafeResponse: { userId: ctx.userId, result: ctx.result }, status: 200 }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('happy: doWork provides extra keys beyond what respond needs', () => {
      hipExpressHandlerFactory({
        preAuthorize: () => ({}),
        finalAuthorize: () => true,
        doWork: () => ({ result: 'done', sideEffect: true, count: 5 }),
        respond: (ctx: any) => ({ unsafeResponse: { r: ctx.result }, status: 200 }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('sad: respond requests a key not produced by any prior stage', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({}),
          finalAuthorize: () => true,
          doWork: () => ({ result: 'done' }),
          respond: (ctx: { missing: string }) => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: respond requests a key with wrong type', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({}),
          finalAuthorize: () => true,
          doWork: () => ({ result: 'done' }),
          respond: (ctx: { result: number }) => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: respond requests partially provided key', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({}),
          finalAuthorize: () => true,
          doWork: () => ({ result: 'done' }),
          respond: (ctx: { result: string; extra: number }) => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // respond
  // ─────────────────────────────────────────────────────────────────────
  describe('respond', () => {
    it('happy: respond accesses data from every prior stage combined', () => {
      hipExpressHandlerFactory({
        sanitizeParams: () => ({ id: 'p1' }),
        sanitizeBody: () => ({ name: 'test' }),
        sanitizeQueryParams: () => ({ page: 1 }),
        preAuthorize: (ctx: { params: { id: string } }) => ({ userId: 'u1' }),
        attachData: (ctx: { userId: string }) => ({ record: { title: 'hi' } }),
        finalAuthorize: (ctx: { record: { title: string } }) => true,
        doWork: () => ({ saved: true }),
        respond: (ctx: any) => ({ unsafeResponse: { ok: true }, status: 200 }),
        sanitizeResponse: (r: any) => r,
      });
    });

    it('sad: respond requests key only available in a later stage (sanitizeResponse)', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: () => ({}),
          finalAuthorize: () => true,
          respond: (ctx: { sanitized: boolean }) => ({ unsafeResponse: {} }),
          sanitizeResponse: () => ({ sanitized: true }),
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cross-cutting sad paths
  // ─────────────────────────────────────────────────────────────────────
  describe('cross-cutting sad paths', () => {
    it('sad: preAuthorize requests a key from params that was not sanitized', () => {
      function expectError() {
        // @ts-expect-error
        hipExpressHandlerFactory({
          preAuthorize: (ctx: { params: { orgId: string } }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: preAuthorize requests body key with wrong type', () => {
      function expectError() {
        hipExpressHandlerFactory({
          // @ts-expect-error
          sanitizeBody: () => ({ count: 5 }),
          preAuthorize: (ctx: { body: { count: string } }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: preAuthorize requests partial body (wants more keys than sanitizeBody provides)', () => {
      function expectError() {
        hipExpressHandlerFactory({
          // @ts-expect-error
          sanitizeBody: () => ({ name: 'test' }),
          preAuthorize: (ctx: { body: { name: string; age: number } }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: attachData requests key from sanitizeParams with wrong type (way before)', () => {
      function expectError() {
        hipExpressHandlerFactory({
          // @ts-expect-error
          sanitizeParams: () => ({ id: 'abc' }),
          preAuthorize: () => ({}),
          attachData: (ctx: { params: { id: number } }) => ({}),
          finalAuthorize: () => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });

    it('sad: finalAuthorize requests partial params from sanitizeParams (way before)', () => {
      function expectError() {
        hipExpressHandlerFactory({
          // @ts-expect-error
          sanitizeParams: () => ({ id: 'abc' }),
          preAuthorize: () => ({}),
          attachData: () => ({}),
          finalAuthorize: (ctx: { params: { id: string; slug: string } }) => true,
          respond: () => ({ unsafeResponse: {} }),
          sanitizeResponse: (r: any) => r,
        });
      }
    });
  });
});
