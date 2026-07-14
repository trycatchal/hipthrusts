import { HipBadInputs, HipNotFound } from './errors.js';
import { WithInputSlice } from './index.js';
import {
  Execute,
  LoadResources,
  RedactResponse,
  SanitizeInputs,
} from './lifecycle-functions.js';
import { Constructor } from './types.js';

import mask from 'json-mask';

interface ModelWithFindById<TInstance = any> {
  findById(id: string): { exec(): Promise<TInstance> };
}

interface ModelWithFindOne<TInstance = any> {
  findOne(options: any): { exec(): Promise<TInstance> };
}

interface HasValidateSync {
  validateSync(paths?: any, options?: any): { errors: any[] };
}
interface HasToObject<T> {
  toObject(options?: any): T;
}

export function htMongooseFactory(mongoose: any) {
  function findByIdRequired(Model: ModelWithFindById) {
    return async function(id: string) {
      if (!id || !id.toString()) {
        throw new HipBadInputs('Missing dependent resource ID');
      }
      const result = await Model.findById(id).exec();
      if (!result) {
        throw new HipNotFound('Resource not found');
      }
      return result;
    };
  }

  function findOneByRequired(Model: ModelWithFindOne, fieldName: string) {
    return async function(fieldValue: any) {
      if (!fieldValue || !fieldValue.toString()) {
        throw new HipBadInputs('Missing dependent resource value');
      }
      const result = await Model.findOne({
        [fieldName]: {
          $eq: fieldValue,
        },
      }).exec();
      if (!result) {
        throw new HipNotFound('Resource not found');
      }
      return result;
    };
  }

  function stripIdTransform(doc: any, ret: { _id: any }, _options: any) {
    delete ret._id;
    return ret;
  }

  function deepWipeDefault(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(elm => deepWipeDefault(elm));
    } else if (typeof obj === 'object' && !obj.instanceOfSchema) {
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

  type DocumentFactory<T> = (
    obj: any,
    ...rest: any
  ) => HasValidateSync & HasToObject<T>;

  function documentFactoryFromForRequest(schemaConfigObject: any) {
    const schema = new mongoose.Schema(schemaConfigObject, {
      _id: false,
      id: false,
    });

    return (initializerPojo: any) =>
      new mongoose.Document(initializerPojo, schema);
  }

  function documentFactoryFromForResponse(schemaConfigObject: any) {
    const schema = new mongoose.Schema(schemaConfigObject, {
      _id: true,
      id: true,
    });

    return (initializerPojo: any) =>
      new mongoose.Document(initializerPojo, schema);
  }

  // Validates the whole inputs object against a single mongoose schema.
  // For per-slice validation (one schema per params/body/etc.), use SanitizeInputsSliceWithMongoose.
  // @note for docs: NEVER use _id - mongoose gives it special treatment
  // also, ALWAYS remember to make required fields required cause mongoose will STRIP invalid fields first!
  function SanitizeInputsWithMongoose<
    TSafe extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>,
    TUnsafe extends object
  >(DocFactory: TDocFactory, options?: { validateModifiedOnly?: boolean }) {
    return SanitizeInputs((unsafeInputs: TUnsafe) => {
      const doc = DocFactory(unsafeInputs);
      const validateErrors = doc.validateSync(
        undefined,
        options?.validateModifiedOnly
          ? { validateModifiedOnly: true }
          : undefined
      );
      if (validateErrors !== undefined) {
        throw new HipBadInputs('Inputs not valid');
      }
      return doc.toObject({ transform: stripIdTransform }) as TSafe;
    });
  }

  // Per-slice mongoose validation; composes via WithInputSlice for per-slot ergonomics.
  // Example: SanitizeInputsSliceWithMongoose('params', ThingByIdParamFactory)
  function SanitizeInputsSliceWithMongoose<
    TSliceName extends string,
    TSafeSlice extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>,
    TUnsafeSlice extends object
  >(
    sliceName: TSliceName,
    DocFactory: TDocFactory,
    options?: { validateModifiedOnly?: boolean }
  ) {
    return WithInputSlice<TSliceName, TUnsafeSlice, TSafeSlice>(
      sliceName,
      (unsafeSlice: TUnsafeSlice) => {
        const doc = DocFactory(unsafeSlice);
        const validateErrors = doc.validateSync(
          undefined,
          options?.validateModifiedOnly
            ? { validateModifiedOnly: true }
            : undefined
        );
        if (validateErrors !== undefined) {
          throw new HipBadInputs(`${sliceName} not valid`);
        }
        return doc.toObject({ transform: stripIdTransform }) as TSafeSlice;
      }
    );
  }

  function SaveOnDocumentFrom(propertyKeyOfDocument: string) {
    return Execute(async (context: any) => {
      if (context[propertyKeyOfDocument]) {
        try {
          return await context[propertyKeyOfDocument].save();
        } catch {
          throw new HipBadInputs(
            'Unable to save. Please check if data sent was valid.'
          );
        }
      } else {
        throw new HipBadInputs('Resource not found');
      }
    });
  }

  // Updates a document with data from a key on context. By default reads from
  // `context.inputs.body` (the canonical body slice). Pass `propertyKeyWithNewData`
  // as a dot path or top-level key for custom layouts.
  function UpdateDocumentFromTo(
    propertyKeyOfDocument: string,
    propertyKeyWithNewData: string = 'inputs.body'
  ) {
    const pathSegments = propertyKeyWithNewData.split('.');
    function readPath(ctx: any) {
      return pathSegments.reduce(
        (acc, seg) => (acc == null ? acc : acc[seg]),
        ctx
      );
    }
    return Execute(async (context: any) => {
      if (context[propertyKeyOfDocument]) {
        return await context[propertyKeyOfDocument].set(readPath(context));
      } else {
        throw new HipBadInputs('Resource not found');
      }
    });
  }

  function RedactResponseWithMongoose<
    TSafeResponse extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>
  >(DocFactory: TDocFactory) {
    return RedactResponse((unsafeResponse: any) => {
      const doc = DocFactory(unsafeResponse);
      return doc.toObject() as TSafeResponse;
    });
  }

  function PojoToDocument<
    TPojoKey extends string,
    TMongooseModel extends Constructor<any>,
    TContextIn extends { [key in TPojoKey]: any }
  >(pojoKey: TPojoKey, modelClass: TMongooseModel, newDocKey: string) {
    return LoadResources((context: TContextIn) => {
      return {
        [newDocKey]: new modelClass(context[pojoKey]),
      };
    });
  }

  return {
    SanitizeInputsWithMongoose,
    SanitizeInputsSliceWithMongoose,
    PojoToDocument,
    RedactResponseWithMongoose,
    UpdateDocumentFromTo,
    SaveOnDocumentFrom,
    documentFactoryFromForRequest,
    documentFactoryFromForResponse,
    dtoSchemaObj,
    findByIdRequired,
    findOneByRequired,
    stripIdTransform,
  };
}
