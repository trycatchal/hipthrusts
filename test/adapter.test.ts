import { describe, it, expect } from 'vitest';
import { defineHandler, prepareHipthrustable } from '../src/adapter';

describe('defineHandler', () => {
  it('returns the config unchanged (identity function for type inference)', () => {
    const config = {
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: { ok: true }, status: 200 }),
      sanitizeResponse: (r: any) => r,
    };
    const result = defineHandler(config);
    expect(result.preAuthorize).toBe(config.preAuthorize);
    expect(result.finalAuthorize).toBe(config.finalAuthorize);
    expect(result.respond).toBe(config.respond);
    expect(result.sanitizeResponse).toBe(config.sanitizeResponse);
  });
});

describe('prepareHipthrustable', () => {
  it('throws if required methods are missing', () => {
    expect(() => prepareHipthrustable({} as any)).toThrow(/Missing instance method/);
  });

  it('fills in defaults for optional stages', () => {
    const handler = defineHandler({
      preAuthorize: () => true,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const prepared = prepareHipthrustable(handler as any);
    expect(prepared.initPreContext).toBeTypeOf('function');
    expect(prepared.sanitizeParams).toBeTypeOf('function');
    expect(prepared.sanitizeQueryParams).toBeTypeOf('function');
    expect(prepared.sanitizeBody).toBeTypeOf('function');
    expect(prepared.attachData).toBeTypeOf('function');
    expect(prepared.doWork).toBeTypeOf('function');
  });

  it('preserves user-defined optional stages', () => {
    const customAttachData = async () => ({ data: 'attached' });
    const handler = defineHandler({
      preAuthorize: () => true,
      attachData: customAttachData,
      finalAuthorize: () => true,
      respond: () => ({ unsafeResponse: {}, status: 200 }),
      sanitizeResponse: (r: any) => r,
    });
    const prepared = prepareHipthrustable(handler as any);
    expect(prepared.attachData).toBe(customAttachData);
  });
});
