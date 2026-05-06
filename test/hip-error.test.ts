import { describe, it, expect } from 'vitest';
import { HipError } from '../src/core';

describe('HipError', () => {
  it('creates an error with statusCode and message', () => {
    const err = new HipError(404, 'Not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('HipError');
  });

  it('has output property for backwards compatibility', () => {
    const err = new HipError(403, 'Forbidden');
    expect(err.output.statusCode).toBe(403);
    expect(err.output.payload.message).toBe('Forbidden');
  });

  it('isHipError returns true for HipError instances', () => {
    expect(HipError.isHipError(new HipError(500, 'Internal'))).toBe(true);
  });

  it('isHipError returns false for non-HipError values', () => {
    expect(HipError.isHipError(new Error('plain'))).toBe(false);
    expect(HipError.isHipError(null)).toBe(false);
    expect(HipError.isHipError(undefined)).toBe(false);
    expect(HipError.isHipError('string')).toBe(false);
    expect(HipError.isHipError(42)).toBe(false);
  });
});
