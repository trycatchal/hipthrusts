import { HipBadInputs, HipNotFound } from './errors.js';
import { SanitizeInputsSlices } from './index.js';
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

interface ModelWithFind<TInstance = any> {
  find(filter: any): { exec(): Promise<TInstance[]> };
}

// The context contribution/requirement for tenant-scoped list endpoints: some
// fragment contributes `queryScope` (a mongo filter restricting what the
// caller may see) and the scoped finders below type-REQUIRE it, so forgetting
// the scope is a compile error instead of a cross-tenant data leak.
export interface HasQueryScope {
  queryScope: Record<string, unknown>;
}

interface HasValidateSync {
  validateSync(paths?: any, options?: any): { errors: any[] };
}
interface HasToObject<T> {
  toObject(options?: any): T;
}

export function htMongooseFactory(mongoose: any) {
  function findByIdRequired(Model: ModelWithFindById) {
    return async function (id: string) {
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
    return async function (fieldValue: any) {
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
      return obj.map((elm) => deepWipeDefault(elm));
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
    TUnsafe extends object,
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

  // Per-slice mongoose validation for one or more named slices; composes via
  // SanitizeInputsSlices, so only explicitly-sanitized slices survive the
  // sanitize stage. Example:
  //   SanitizeInputsSlicesWithMongoose({ params: ThingByIdParamFactory })
  function SanitizeInputsSlicesWithMongoose<
    TFactories extends Record<string, DocumentFactory<any>>,
  >(factories: TFactories, options?: { validateModifiedOnly?: boolean }) {
    const sanitizers = Object.fromEntries(
      Object.keys(factories).map((sliceName) => [
        sliceName,
        (unsafeSlice: unknown) => {
          const doc = factories[sliceName](unsafeSlice);
          const validateErrors = doc.validateSync(
            undefined,
            options?.validateModifiedOnly
              ? { validateModifiedOnly: true }
              : undefined
          );
          if (validateErrors !== undefined) {
            throw new HipBadInputs(`${sliceName} not valid`);
          }
          return doc.toObject({ transform: stripIdTransform });
        },
      ])
    ) as {
      [K in keyof TFactories & string]: (
        unsafeSlice: unknown
      ) => ReturnType<ReturnType<TFactories[K]>['toObject']>;
    };
    return SanitizeInputsSlices(sanitizers);
  }

  // LoadResources fragment: fetches Model.find with the composed filter
  // `{ ...ctx.queryScope, ...extraFilter }` and stores the rows under
  // `docsKey`. `queryScope` is REQUIRED in the context type, so the deps-met
  // machinery forces some earlier fragment (e.g. a LoadResources contributing
  // the caller's tenant filter) to provide it — authorization-as-query-scope
  // by construction.
  function loadScopedTo<TKey extends string>(
    Model: ModelWithFind,
    docsKey: TKey,
    extraFilter?: object
  ) {
    return LoadResources(async (context: HasQueryScope) => {
      return {
        [docsKey]: await Model.find({
          ...context.queryScope,
          ...(extraFilter || {}),
        }).exec(),
      } as Record<TKey, any[]>;
    });
  }

  // The plain list endpoint in one fragment: loadScopedTo on the load stage
  // (so the rows sit in context for finalAuthorize / redactResponse /
  // downstream execute stages) plus a trivial execute that returns them.
  // Fetching lives on the LOAD stage — piping your own execute after this one
  // overrides the response without re-running or wasting the query.
  function findScoped<TKey extends string = 'scopedDocs'>(
    Model: ModelWithFind,
    extraFilter?: object,
    docsKey?: TKey
  ) {
    const key = (docsKey ?? 'scopedDocs') as TKey;
    return {
      ...loadScopedTo(Model, key, extraFilter),
      ...Execute((context: Record<TKey, any[]>) => context[key]),
    };
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
    TInstance extends ReturnType<TDocFactory>,
  >(DocFactory: TDocFactory) {
    return RedactResponse((unsafeResponse: any) => {
      const doc = DocFactory(unsafeResponse);
      return doc.toObject() as TSafeResponse;
    });
  }

  function PojoToDocument<
    TPojoKey extends string,
    TMongooseModel extends Constructor<any>,
    TContextIn extends { [key in TPojoKey]: any },
  >(pojoKey: TPojoKey, modelClass: TMongooseModel, newDocKey: string) {
    return LoadResources((context: TContextIn) => {
      return {
        [newDocKey]: new modelClass(context[pojoKey]),
      };
    });
  }

  return {
    SanitizeInputsWithMongoose,
    SanitizeInputsSlicesWithMongoose,
    PojoToDocument,
    RedactResponseWithMongoose,
    UpdateDocumentFromTo,
    SaveOnDocumentFrom,
    documentFactoryFromForRequest,
    documentFactoryFromForResponse,
    dtoSchemaObj,
    findByIdRequired,
    findOneByRequired,
    findScoped,
    loadScopedTo,
    stripIdTransform,
  };
}
