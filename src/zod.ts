import Boom from '@hapi/boom';
import { z } from 'zod';
import {
  AttachData,
  DoWork,
  SanitizeBody,
  SanitizeParams,
  SanitizeQueryParams,
  SanitizeResponse,
} from './lifecycle-functions';

// tslint:disable-next-line:no-var-requires
const mask = require('json-mask');

interface ModelWithFindById<TInstance = any> {
  findById(id: string): { exec(): Promise<TInstance> };
}

interface ModelWithFindOne<TInstance = any> {
  findOne(options: any): { exec(): Promise<TInstance> };
}

export function htZodFactory() {
  function findByIdRequired(Model: ModelWithFindById) {
    // tslint:disable-next-line:only-arrow-functions
    return async function(id: string) {
      // prevent accidental searching for all from previous stages
      // (e.g. if someone forgot to make id param required in schema so
      // validation passes when it shouldn't)
      if (!id || !id.toString()) {
        throw Boom.badRequest('Missing dependent resource ID');
      }
      const result = await Model.findById(id).exec();
      if (!result) {
        throw Boom.notFound('Resource not found');
      }
      return result;
    };
  }

  function findOneByRequired(Model: ModelWithFindOne, fieldName: string) {
    // tslint:disable-next-line:only-arrow-functions
    return async function(fieldValue: any) {
      if (!fieldValue || !fieldValue.toString()) {
        throw Boom.badRequest('Missing dependent resource value');
      }
      const result = await Model.findOne({
        [fieldName]: {
          $eq: fieldValue,
        },
      }).exec();
      if (!result) {
        throw Boom.notFound('Resource not found');
      }
      return result;
    };
  }

  function stripIdTransform(obj: any) {
    const { _id, ...rest } = obj;
    return rest;
  }

  function deepWipeDefault(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(elm => deepWipeDefault(elm));
    } else if (typeof obj === 'object' && obj !== null) {
      return Object.keys(obj).reduce((acc, key) => {
        return {
          ...acc,
          ...(key === 'default' ? {} : { [key]: deepWipeDefault(obj[key]) }),
        };
      }, {});
    } else {
      return obj;
    }
  }

  function dtoSchemaObj(schemaConfigObject: any, maskConfig: string) {
    return deepWipeDefault(mask(schemaConfigObject, maskConfig));
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

  function SaveOnDocumentFrom(propertyKeyOfDocument: string) {
    return DoWork(async (context: any) => {
      if (context[propertyKeyOfDocument]) {
        try {
          return await context[propertyKeyOfDocument].save();
        } catch (err) {
          throw Boom.badData(
            'Unable to save. Please check if data sent was valid.'
          );
        }
      } else {
        throw Boom.badRequest('Resource not found');
      }
    });
  }

  function UpdateDocumentFromTo(
    propertyKeyOfDocument: string,
    propertyKeyWithNewData: string = 'body'
  ) {
    return DoWork(async (context: any) => {
      if (context[propertyKeyOfDocument]) {
        return await context[propertyKeyOfDocument].set(
          context[propertyKeyWithNewData]
        );
      } else {
        throw Boom.badRequest('Resource not found');
      }
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
    PojoToValidated,
    SanitizeResponseWithZod,
    UpdateDocumentFromTo,
    SaveOnDocumentFrom,
    dtoSchemaObj,
    findByIdRequired,
    findOneByRequired,
    stripIdTransform,
  };
}
