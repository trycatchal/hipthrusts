// Type-level tests for the switch composers: RedactResponseSwitch derives a
// real deps-met context requirement from its dot-path key, and its response
// type is the union of the case redactors' returns.
import { describe, expectTypeOf, it } from 'vitest';
import {
  RedactResponse,
  RedactResponseSwitch,
  SanitizeInputsSwitch,
  SanitizeInputs,
} from '../src/index.js';
import { toNextHandler } from '../src/next.js';

const baseStages = {
  sanitizeInputs: (i: any) => i,
  preAuthorize: () => true,
  execute: () => ({ names: ['a'] as string[], emails: ['e'] as string[] }),
};

const EmailAwareRedact = RedactResponseSwitch('canSeeEmails', {
  true: RedactResponse((u: { names: string[]; emails: string[] }) => u),
  false: RedactResponse((u: { names: string[]; emails: string[] }) => ({
    names: u.names,
  })),
});

describe('RedactResponseSwitch deps-met', () => {
  it('compiles when a stage contributes the switch key', () => {
    const handler = toNextHandler({
      ...baseStages,
      finalAuthorize: () => ({ canSeeEmails: true }),
      ...EmailAwareRedact,
    });
    expectTypeOf(handler).toBeFunction();
  });

  it('fails deps-met when nothing contributes the switch key', () => {
    const conf = {
      ...baseStages,
      finalAuthorize: () => true,
      ...EmailAwareRedact,
    };
    // @ts-expect-error - nothing contributes `canSeeEmails` to the context
    toNextHandler(conf);
  });

  it('types the response as the union of the case redactors', () => {
    type Out = ReturnType<(typeof EmailAwareRedact)['redactResponse']>;
    expectTypeOf<Out>().toEqualTypeOf<
      { names: string[]; emails: string[] } | { names: string[] }
    >();
  });
});

describe('SanitizeInputsSwitch typing', () => {
  it('types the sanitized inputs as the union of the case sanitizers', () => {
    const frag = SanitizeInputsSwitch('body.kind', {
      email: SanitizeInputs((u: any) => ({
        body: { kind: 'email' as const, address: String(u.body.address) },
      })),
      sms: SanitizeInputs((u: any) => ({
        body: { kind: 'sms' as const, number: String(u.body.number) },
      })),
    });
    type Out = ReturnType<(typeof frag)['sanitizeInputs']>;
    expectTypeOf<Out>().toEqualTypeOf<
      | { body: { kind: 'email'; address: string } }
      | { body: { kind: 'sms'; number: string } }
    >();
  });
});
