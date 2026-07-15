import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HipBadInputs, HipInternal } from '../src/errors';
import { htZodFactory } from '../src/zod';

const {
  SanitizeInputsWithZod,
  SanitizeInputsSliceWithZod,
  RedactResponseWithZod,
  PojoToValidated,
  stripIdTransform,
} = htZodFactory();

describe('SanitizeInputsWithZod', () => {
  const schema = z.object({ name: z.string() });

  it('returns parsed data for valid inputs', () => {
    const { sanitizeInputs } = SanitizeInputsWithZod(schema);
    expect(sanitizeInputs({ name: 'hip' })).toEqual({ name: 'hip' });
  });

  it('throws HipBadInputs carrying the ZodError as detail', () => {
    const { sanitizeInputs } = SanitizeInputsWithZod(schema);
    let caught: unknown;
    try {
      sanitizeInputs({ name: 42 } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HipBadInputs);
    expect((caught as HipBadInputs).detail).toBeInstanceOf(z.ZodError);
  });

  it('strips _id from the parsed result', () => {
    const withId = z.object({ name: z.string(), _id: z.string() });
    const { sanitizeInputs } = SanitizeInputsWithZod(withId);
    expect(sanitizeInputs({ name: 'hip', _id: 'nope' })).toEqual({
      name: 'hip',
    });
  });
});

describe('SanitizeInputsSliceWithZod', () => {
  const params = z.object({ id: z.string() });

  it('sanitizes only the named slice and passes the rest through', () => {
    const { sanitizeInputs } = SanitizeInputsSliceWithZod('params', params);
    const result = sanitizeInputs({
      params: { id: '7' },
      body: { untouched: true },
    });
    expect(result.params).toEqual({ id: '7' });
    expect(result.body).toEqual({ untouched: true });
  });

  it('throws HipBadInputs naming the slice when the slice is invalid', () => {
    const { sanitizeInputs } = SanitizeInputsSliceWithZod('params', params);
    expect(() => sanitizeInputs({ params: {} })).toThrow('params not valid');
  });

  it('accepts missing fields when partial: true', () => {
    const strict = z.object({ id: z.string(), name: z.string() });
    const { sanitizeInputs } = SanitizeInputsSliceWithZod('params', strict, {
      partial: true,
    });
    expect((sanitizeInputs({ params: { id: '7' } }) as any).params).toEqual({
      id: '7',
    });
  });
});

describe('RedactResponseWithZod', () => {
  const publicShape = z.object({ name: z.string() });

  it('returns the schema-shaped response for valid data', () => {
    const { redactResponse } = RedactResponseWithZod(publicShape);
    expect(redactResponse({ name: 'hip' })).toEqual({ name: 'hip' });
  });

  it('drops fields not in the schema (redaction)', () => {
    const { redactResponse } = RedactResponseWithZod(publicShape);
    expect(redactResponse({ name: 'hip', passwordHash: 'x' })).toEqual({
      name: 'hip',
    });
  });

  it('throws HipInternal when the response does not validate', () => {
    const { redactResponse } = RedactResponseWithZod(publicShape);
    expect(() => redactResponse({ wrong: true })).toThrow(HipInternal);
  });
});

describe('PojoToValidated', () => {
  const schema = z.object({ n: z.number() });

  it('validates the pojo on context and stores it under the new key', () => {
    const { loadResources } = PojoToValidated('raw', schema, 'validated');
    expect(loadResources({ raw: { n: 1 } })).toEqual({ validated: { n: 1 } });
  });

  it('throws HipBadInputs when the pojo does not validate', () => {
    const { loadResources } = PojoToValidated('raw', schema, 'validated');
    expect(() => loadResources({ raw: { n: 'NaN' } })).toThrow(HipBadInputs);
  });
});

describe('stripIdTransform', () => {
  it('removes _id and keeps everything else', () => {
    expect(stripIdTransform({ _id: 'x', a: 1 })).toEqual({ a: 1 });
  });
});

describe('SanitizeInputsSlicesWithZod', () => {
  const { SanitizeInputsSlicesWithZod } = htZodFactory();
  const shapes = {
    params: z.object({ id: z.string() }),
    body: z.object({ name: z.string() }),
  };

  it('validates every named slice and passes unnamed slices through', () => {
    const { sanitizeInputs } = SanitizeInputsSlicesWithZod(shapes);
    const result = sanitizeInputs({
      params: { id: '7' },
      body: { name: 'hip' },
      headers: { untouched: true },
    });
    expect(result.params).toEqual({ id: '7' });
    expect(result.body).toEqual({ name: 'hip' });
    expect(result.headers).toEqual({ untouched: true });
  });

  it('throws HipBadInputs naming the offending slice', () => {
    const { sanitizeInputs } = SanitizeInputsSlicesWithZod(shapes);
    expect(() =>
      sanitizeInputs({ params: { id: '7' }, body: { name: 42 } })
    ).toThrow('body not valid');
  });

  it('strips _id from each validated slice', () => {
    const { sanitizeInputs } = SanitizeInputsSlicesWithZod({
      body: z.object({ name: z.string(), _id: z.string() }),
    });
    expect(sanitizeInputs({ body: { name: 'hip', _id: 'nope' } }).body).toEqual(
      { name: 'hip' }
    );
  });
});
