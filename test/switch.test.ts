import { describe, expect, it } from 'vitest';
import {
  RedactResponse,
  RedactResponseSwitch,
  SanitizeInputs,
  SanitizeInputsSwitch,
} from '../src/index.js';
import { HipBadInputs, HipInternal } from '../src/errors.js';

describe('RedactResponseSwitch (core)', () => {
  const cases = {
    admin: RedactResponse((u: { names: string[]; emails: string[] }) => u),
    member: RedactResponse((u: { names: string[]; emails: string[] }) => ({
      names: u.names,
    })),
  };
  const unsafe = { names: ['a'], emails: ['a@x.co'] };

  it('delegates to the case picked from a top-level context key', () => {
    const { redactResponse } = RedactResponseSwitch('role', cases);
    expect(redactResponse(unsafe, { role: 'member' })).toEqual({
      names: ['a'],
    });
    expect(redactResponse(unsafe, { role: 'admin' })).toBe(unsafe);
  });

  it('supports a nested dot-path key (a key of a key)', () => {
    const { redactResponse } = RedactResponseSwitch('principal.role', cases);
    expect(
      redactResponse(unsafe, { principal: { role: 'member' } } as any)
    ).toEqual({ names: ['a'] });
  });

  it('stringifies boolean keys so true/false cases work', () => {
    const { redactResponse } = RedactResponseSwitch('canSeeEmails', {
      true: cases.admin,
      false: cases.member,
    });
    expect(redactResponse(unsafe, { canSeeEmails: false })).toEqual({
      names: ['a'],
    });
  });

  it('passes the context through to the chosen (two-param) redactor', () => {
    const { redactResponse } = RedactResponseSwitch('role', {
      admin: {
        redactResponse: (u: typeof unsafe, ctx: any) => ({
          names: u.names,
          decidedBy: ctx.role,
        }),
      },
    });
    expect(redactResponse(unsafe, { role: 'admin' })).toEqual({
      names: ['a'],
      decidedBy: 'admin',
    });
  });

  it('throws HipInternal for an unregistered key without leaking it in the message', () => {
    const { redactResponse } = RedactResponseSwitch('role', cases);
    let caught: unknown;
    try {
      redactResponse(unsafe, { role: 'super-secret-role' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HipInternal);
    expect((caught as HipInternal).message).not.toContain('super-secret-role');
    expect((caught as HipInternal).detail).toEqual({
      keyPath: 'role',
      key: 'super-secret-role',
    });
  });
});

describe('SanitizeInputsSwitch (core)', () => {
  const cases = {
    email: SanitizeInputs((u: any) => ({
      body: { kind: 'email' as const, address: String(u.body.address) },
    })),
    sms: SanitizeInputs((u: any) => ({
      body: { kind: 'sms' as const, number: String(u.body.number) },
    })),
  };

  it('delegates to the case picked from the unsafe inputs', () => {
    const { sanitizeInputs } = SanitizeInputsSwitch('body.kind', cases);
    expect(
      sanitizeInputs({ body: { kind: 'sms', number: '555', junk: true } })
    ).toEqual({ body: { kind: 'sms', number: '555' } });
  });

  it('rejects an unknown discriminator with HipBadInputs and a generic message', () => {
    const { sanitizeInputs } = SanitizeInputsSwitch('body.kind', cases);
    let caught: unknown;
    try {
      sanitizeInputs({ body: { kind: 'evil-$where' } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HipBadInputs);
    expect((caught as HipBadInputs).message).not.toContain('evil');
  });

  it('rejects inputs where the discriminator path is absent', () => {
    const { sanitizeInputs } = SanitizeInputsSwitch('body.kind', cases);
    expect(() => sanitizeInputs({})).toThrow(HipBadInputs);
  });
});
