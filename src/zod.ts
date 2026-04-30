import Boom from '@hapi/boom';
import { z } from 'zod';
import {
  AttachData,
  SanitizeBody,
  SanitizeParams,
  SanitizeQueryParams,
  SanitizeResponse,
} from './lifecycle-functions';

export function htZodFactory() {
  function stripIdTransform(obj: any) {
    const { _id, ...rest } = obj;
    return rest;
  }

  function SanitizeParamsWithZod<
    TSafeParam extends z.infer<TSchema>,
    TSchema extends z.ZodType<any, any, any>,
    TUnsafeParam extends object
  >(schema: TSchema) {
    return SanitizeParams((unsafeParams: TUnsafeParam) => {
      const parseResult = schema.safeParse(unsafeParams);
      if (!parseResult.success) {
        throw Boom.badRequest('Params not valid', parseResult.error);
      }
      return stripIdTransform(parseResult.data) as TSafeParam;
    });
  }

  function SanitizeQueryParamsWithZod<
    TSafeQueryParam extends z.infer<TSchema>,
    TSchema extends z.ZodType<any, any, any>,
    TUnsafeQueryParam extends object
  >(schema: TSchema) {
    return SanitizeQueryParams((unsafeQueryParams: TUnsafeQueryParam) => {
      const parseResult = schema.safeParse(unsafeQueryParams);
      if (!parseResult.success) {
        throw Boom.badRequest('Query params not valid', parseResult.error);
      }
      return stripIdTransform(parseResult.data) as TSafeQueryParam;
    });
  }

  // @note: sanitize body validates all fields present in the body
  // For partial updates, use schema.partial() to make all fields optional
  function SanitizeBodyWithZod<
    TSafeBody extends z.infer<TSchema>,
    TSchema extends z.ZodObject<any, any>,
    TUnsafeBody extends object
  >(schema: TSchema, options?: { partial?: boolean }) {
    const effectiveSchema = options?.partial ? schema.partial() : schema;

    return SanitizeBody((unsafeBody: TUnsafeBody) => {
      const parseResult = effectiveSchema.safeParse(unsafeBody);
      if (!parseResult.success) {
        throw Boom.badRequest('Body not valid', parseResult.error);
      }
      return stripIdTransform(parseResult.data) as TSafeBody;
    });
  }

  function SanitizeResponseWithZod<
    TSafeResponse extends z.infer<TSchema>,
    TSchema extends z.ZodType<any, any, any>
  >(schema: TSchema) {
    return SanitizeResponse((unsafeResponse: any) => {
      const parseResult = schema.safeParse(unsafeResponse);
      if (!parseResult.success) {
        // In production, you might want to log this error but return a safe default
        // or throw an internal server error since response validation failing
        // indicates a bug in your code, not invalid user input
        throw Boom.internal('Response validation failed', parseResult.error);
      }
      return parseResult.data as TSafeResponse;
    });
  }

  function PojoToValidated<
    TPojoKey extends string,
    TSchema extends z.ZodType<any, any, any>,
    TContextIn extends { [key in TPojoKey]: any }
  >(pojoKey: TPojoKey, schema: TSchema, newValidatedKey: string) {
    return AttachData((context: TContextIn) => {
      const parseResult = schema.safeParse(context[pojoKey]);
      if (!parseResult.success) {
        throw Boom.badRequest('Data validation failed', parseResult.error);
      }
      return {
        [newValidatedKey]: parseResult.data,
      };
    });
  }

  return {
    SanitizeBodyWithZod,
    SanitizeParamsWithZod,
    SanitizeQueryParamsWithZod,
    SanitizeResponseWithZod,
    PojoToValidated,
    stripIdTransform,
  };
}
