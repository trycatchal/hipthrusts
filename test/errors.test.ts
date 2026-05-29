import { describe, expect, it } from 'vitest';
import {
  HipBadInputs,
  HipConflict,
  HipError,
  hipErrorToStatus,
  HipForbidden,
  HipInternal,
  HipNotFound,
  HipRedirect,
  HipUnauthorized,
  isHipError,
} from '../src/errors';

describe('HipError hierarchy', () => {
  it('each subclass carries its semantic kind and extends Error', () => {
    expect(new HipBadInputs().kind).toBe('badInputs');
    expect(new HipUnauthorized().kind).toBe('unauthorized');
    expect(new HipForbidden().kind).toBe('forbidden');
    expect(new HipNotFound().kind).toBe('notFound');
    expect(new HipConflict().kind).toBe('conflict');
    expect(new HipInternal().kind).toBe('internal');
    expect(new HipBadInputs()).toBeInstanceOf(Error);
    expect(new HipBadInputs()).toBeInstanceOf(HipError);
  });

  it('preserves message, detail and a useful name', () => {
    const err = new HipBadInputs('bad thing', { field: 'email' });
    expect(err.message).toBe('bad thing');
    expect(err.detail).toEqual({ field: 'email' });
    expect(err.name).toBe('HipBadInputs');
  });

  it('isHipError guards correctly', () => {
    expect(isHipError(new HipForbidden())).toBe(true);
    expect(isHipError(new Error('x'))).toBe(false);
    expect(isHipError(new HipRedirect('/login'))).toBe(false);
    expect(isHipError(null)).toBe(false);
    expect(isHipError('nope')).toBe(false);
  });
});

describe('hipErrorToStatus', () => {
  it('maps each kind to the right HTTP status', () => {
    expect(hipErrorToStatus(new HipBadInputs())).toBe(422);
    expect(hipErrorToStatus(new HipUnauthorized())).toBe(401);
    expect(hipErrorToStatus(new HipForbidden())).toBe(403);
    expect(hipErrorToStatus(new HipNotFound())).toBe(404);
    expect(hipErrorToStatus(new HipConflict())).toBe(409);
    expect(hipErrorToStatus(new HipInternal())).toBe(500);
  });
});

describe('HipRedirect', () => {
  it('defaults to a 302 and keeps the url', () => {
    const r = new HipRedirect('/dashboard');
    expect(r.redirectUrl).toBe('/dashboard');
    expect(r.redirectCode).toBe(302);
    expect(new HipRedirect('/x', 307).redirectCode).toBe(307);
  });
});
