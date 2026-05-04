import { HipError } from './core';
import {
  AttachData,
  DoWork,
  SanitizeBody,
  SanitizeParams,
  SanitizeQueryParams,
  SanitizeResponse,
} from './lifecycle-functions';
import { Constructor } from './types';

// tslint:disable-next-line:no-var-requires
const mask = require('json-mask');

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
    // tslint:disable-next-line:only-arrow-functions
    return async function(id: string) {
      // prevent accidental searching for all from previous stages
      // (e.g. if someone forgot to make id param required in schema so
      // validation passes when it shouldn't - this example is b/c
      // mongoose won't initialize with invalid ObjectIds passed to it.
      if (!id || !id.toString()) {
        throw new HipError(400, 'Missing dependent resource ID');
      }
      const result = await Model.findById(id).exec();
      if (!result) {
        throw new HipError(404, 'Resource not found');
      }
      return result;
    };
  }

  function findOneByRequired(Model: ModelWithFindOne, fieldName: string) {
    // tslint:disable-next-line:only-arrow-functions
    return async function(fieldValue: any) {
      if (!fieldValue || !fieldValue.toString()) {
        throw new HipError(400, 'Missing dependent resource value');
      }
      const result = await Model.findOne({
        [fieldName]: {
          $eq: fieldValue,
        },
      }).exec();
      if (!result) {
        throw new HipError(404, 'Resource not found');
      }
      return result;
    };
  }

  function stripIdTransform(doc: any, ret: { _id: any }, options: any) {
    delete ret._id;
    return ret;
  }

  function deepWipeDefault(obj: any): any {
    if (Array.isArray(obj)) {
      // if this looks weird, realize that "enum" takes an array ;)
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

  // @note for docs: NEVER use _id - mongoose gives it special treatment
  // also, ALWAYS rememver to make required fields required cause mongoose will STRIP invalid fields first!
  // figure out how to make that security gotcha harder to happen
  function SanitizeParamsWithMongoose<
    TSafeParam extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>,
    TUnsafeParam extends object
  >(DocFactory: TDocFactory) {
    return SanitizeParams((unsafeParams: TUnsafeParam) => {
      const doc = DocFactory(unsafeParams);
      const validateErrors = doc.validateSync();
      if (validateErrors !== undefined) {
        throw new HipError(400, 'Params not valid');
      }
      // @tswtf: why do I need to force this?!
      return doc.toObject({ transform: stripIdTransform }) as TSafeParam;
    });
  }

  function SanitizeQueryParamsWithMongoose<
    TSafeQueryParam extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>,
    TUnsafeQueryParam extends object
  >(DocFactory: TDocFactory) {
    return SanitizeQueryParams((unsafeQueryParams: TUnsafeQueryParam) => {
      const doc = DocFactory(unsafeQueryParams);
      const validateErrors = doc.validateSync();
      if (validateErrors !== undefined) {
        throw new HipError(400, 'Query params not valid');
      }
      return doc.toObject({ transform: stripIdTransform }) as TSafeQueryParam;
    });
  }

  // @note: sanitize body validates modified only!  This is cause you usually will only send fields to update.
  function SanitizeBodyWithMongoose<
    TSafeBody extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>,
    TUnsafeBody extends object
  >(DocFactory: TDocFactory) {
    return SanitizeBody((unsafeBody: TUnsafeBody) => {
      const doc = DocFactory(unsafeBody);
      const validateErrors = doc.validateSync(undefined, {
        validateModifiedOnly: true,
      });
      if (validateErrors !== undefined) {
        throw new HipError(400, 'Body not valid');
      }
      // @tswtf: why do I need to force this?!
      return doc.toObject({ transform: stripIdTransform }) as TSafeBody;
    });
  }

  function SaveOnDocumentFrom(propertyKeyOfDocument: string) {
    return DoWork(async (context: any) => {
      if (context[propertyKeyOfDocument]) {
        try {
          return await context[propertyKeyOfDocument].save();
        } catch (err) {
          throw new HipError(
            422,
            'Unable to save. Please check if data sent was valid.'
          );
        }
      } else {
        throw new HipError(400, 'Resource not found');
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
        throw new HipError(400, 'Resource not found');
      }
    });
  }

  function SanitizeResponseWithMongoose<
    TSafeResponse extends ReturnType<TInstance['toObject']>,
    TDocFactory extends DocumentFactory<any>,
    TInstance extends ReturnType<TDocFactory>
  >(DocFactory: TDocFactory) {
    return SanitizeResponse((unsafeResponse: any) => {
      const doc = DocFactory(unsafeResponse);
      // @tswtf: why do I need to force this?!
      return doc.toObject() as TSafeResponse;
    });
  }

  function PojoToDocument<
    TPojoKey extends string,
    TMongooseModel extends Constructor<any>,
    TContextIn extends { [key in TPojoKey]: any }
  >(pojoKey: TPojoKey, modelClass: TMongooseModel, newDocKey: string) {
    return AttachData((context: TContextIn) => {
      return {
        [newDocKey]: new modelClass(context[pojoKey]),
      };
    });
  }

  return {
    SanitizeBodyWithMongoose,
    SanitizeParamsWithMongoose,
    SanitizeQueryParamsWithMongoose,
    PojoToDocument,
    SanitizeResponseWithMongoose,
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
