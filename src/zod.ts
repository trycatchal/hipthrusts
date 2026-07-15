import { z } from 'zod';
import { HipBadInputs, HipInternal } from './errors.js';
import { SanitizeInputsSlices } from './index.js';
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

  // Validates one or more named slices in a single fragment; each slice key
  // is named in the return type. Built on SanitizeInputsSlices, so only the
  // slices you name here (or in other chained sanitize fragments) survive to
  // later stages — unvalidated slices are dropped after the sanitize stage.
  function SanitizeInputsSlicesWithZod<
    TShapes extends Record<string, z.ZodType<any, any, any>>,
  >(shapes: TShapes) {
    const sanitizers = Object.fromEntries(
      Object.keys(shapes).map((sliceName) => [
        sliceName,
        (unsafeSlice: unknown) => {
          const parseResult = shapes[sliceName].safeParse(unsafeSlice);
          if (!parseResult.success) {
            throw new HipBadInputs(`${sliceName} not valid`, parseResult.error);
          }
          return stripIdTransform(parseResult.data);
        },
      ])
    ) as {
      [K in keyof TShapes & string]: (
        unsafeSlice: unknown
      ) => z.output<TShapes[K]>;
    };
    return SanitizeInputsSlices(sanitizers);
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
    SanitizeInputsSlicesWithZod,
    RedactResponseWithZod,
    PojoToValidated,
    stripIdTransform,
  };
}
