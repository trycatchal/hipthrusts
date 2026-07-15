import { z } from 'zod';
import { HipBadInputs, HipInternal } from './errors.js';
import { WithInputSlice } from './index.js';
import {
  LoadResources,
  RedactResponse,
  SanitizeInputs,
} from './lifecycle-functions.js';

export function htZodFactory() {
  function stripIdTransform(obj: any) {
    const { _id, ...rest } = obj;
    return rest;
  }

  function SanitizeInputsWithZod<
    TSafe extends z.infer<TSchema>,
    TSchema extends z.ZodType<any, any, any>,
    TUnsafe extends object,
  >(schema: TSchema) {
    return SanitizeInputs((unsafeInputs: TUnsafe) => {
      const parseResult = schema.safeParse(unsafeInputs);
      if (!parseResult.success) {
        throw new HipBadInputs('Inputs not valid', parseResult.error);
      }
      return stripIdTransform(parseResult.data) as TSafe;
    });
  }

  function SanitizeInputsSliceWithZod<
    TSliceName extends string,
    TSafeSlice extends z.infer<TSchema>,
    TSchema extends z.ZodType<any, any, any>,
    TUnsafeSlice extends object,
  >(sliceName: TSliceName, schema: TSchema, options?: { partial?: boolean }) {
    const effectiveSchema =
      options?.partial && (schema as any).partial
        ? (schema as any).partial()
        : schema;

    return WithInputSlice<TSliceName, TUnsafeSlice, TSafeSlice>(
      sliceName,
      (unsafeSlice: TUnsafeSlice) => {
        const parseResult = effectiveSchema.safeParse(unsafeSlice);
        if (!parseResult.success) {
          throw new HipBadInputs(`${sliceName} not valid`, parseResult.error);
        }
        return stripIdTransform(parseResult.data) as TSafeSlice;
      }
    );
  }

  // Validates several slices in ONE sanitize fragment. Prefer this over piping
  // multiple SanitizeInputsSliceWithZod fragments when validating e.g. params
  // AND body: the return type names every slice key explicitly.
  // Unvalidated slices pass through untouched (Record<string, any> absorbs them).
  function SanitizeInputsSlicesWithZod<
    TShapes extends Record<string, z.ZodType<any, any, any>>,
  >(shapes: TShapes) {
    return SanitizeInputs(
      (
        unsafeInputs: Record<string, any>
      ): { [K in keyof TShapes]: z.output<TShapes[K]> } & Record<
        string,
        any
      > => {
        const out: Record<string, any> = { ...unsafeInputs };
        for (const sliceName of Object.keys(shapes)) {
          const parseResult = shapes[sliceName].safeParse(
            unsafeInputs[sliceName]
          );
          if (!parseResult.success) {
            throw new HipBadInputs(`${sliceName} not valid`, parseResult.error);
          }
          out[sliceName] = stripIdTransform(parseResult.data);
        }
        return out as { [K in keyof TShapes]: z.output<TShapes[K]> } & Record<
          string,
          any
        >;
      }
    );
  }

  function RedactResponseWithZod<
    TSafeResponse extends z.infer<TSchema>,
    TSchema extends z.ZodType<any, any, any>,
  >(schema: TSchema) {
    return RedactResponse((unsafeResponse: any) => {
      const parseResult = schema.safeParse(unsafeResponse);
      if (!parseResult.success) {
        throw new HipInternal('Response validation failed', parseResult.error);
      }
      return parseResult.data as TSafeResponse;
    });
  }

  function PojoToValidated<
    TPojoKey extends string,
    TSchema extends z.ZodType<any, any, any>,
    TContextIn extends { [key in TPojoKey]: any },
  >(pojoKey: TPojoKey, schema: TSchema, newValidatedKey: string) {
    return LoadResources((context: TContextIn) => {
      const parseResult = schema.safeParse(context[pojoKey]);
      if (!parseResult.success) {
        throw new HipBadInputs('Data validation failed', parseResult.error);
      }
      return {
        [newValidatedKey]: parseResult.data,
      };
    });
  }

  return {
    SanitizeInputsWithZod,
    SanitizeInputsSliceWithZod,
    SanitizeInputsSlicesWithZod,
    RedactResponseWithZod,
    PojoToValidated,
    stripIdTransform,
  };
}
