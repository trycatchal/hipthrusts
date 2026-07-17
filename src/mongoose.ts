// Everyday loader fragments (LoadManyTo & friends) are typed against
// mongoose's OWN Model/HydratedDocument generics: structural inference from
// mongoose's overloaded Query/lean machinery resolves to `unknown`, so
// type-only imports are the deliberate trade-off. They erase at runtime —
// mongoose stays an optional peer — but consumers of 'hipthrusts/mongoose'
// need mongoose installed to typecheck (they always did in practice).
import type { HydratedDocument, Model, SortOrder, Types } from 'mongoose';
import { HipBadInputs, HipNotFound } from './errors.js';
import { SanitizeInputsSlices } from './index.js';
import {
  Execute,
  LoadResources,
  RedactResponse,
  SanitizeInputs,
} from './lifecycle-functions.js';
import { JsonMaskFn, loadJsonMask } from './load-json-mask.js';
import { Constructor, NestedPathReq } from './types.js';

let jsonMaskFn: JsonMaskFn | undefined;

interface ModelWithFindById<TInstance = any> {
  findById(id: string): { exec(): Promise<TInstance> };
}

interface ModelWithFindOne<TInstance = any> {
  findOne(options: any): { exec(): Promise<TInstance> };
}

interface ModelWithFind<TInstance = any> {
  find(filter: any, projection?: any): { exec(): Promise<TInstance[]> };
}

// The context contribution/requirement for tenant-scoped list endpoints: some
// fragment contributes `queryScope` (a mongo filter restricting what the
// caller may see) and the scoped finders below type-REQUIRE it, so forgetting
// the scope is a compile error instead of a cross-tenant data leak.
export interface HasQueryScope {
  queryScope: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ctxRef: declarative context-path references for loader filter/id specs.
// ---------------------------------------------------------------------------

// Symbol.for() so the marker survives dual-package (ESM+CJS) loading; the
// unique-symbol assertion lets it be used as a literal key in types.
const CTX_REF: unique symbol = Symbol.for('hipthrusts.ctxRef') as never;

export interface CtxRef<TPath extends string = string> {
  [CTX_REF]: true;
  path: TPath;
}

// Declares "read this value from the lifecycle context at request time" in a
// loader spec: `LoadOneTo(User, 'user', { _id: ctxRef('inputs.body.user') })`.
// The context REQUIREMENT is derived from the path string, so deps-met still
// enforces that an earlier stage provides `inputs.body.user` — with zero
// hand-written context annotations at the call site.
export function ctxRef<TPath extends string>(path: TPath): CtxRef<TPath> {
  return { [CTX_REF]: true, path } as CtxRef<TPath>;
}

function isCtxRef(value: unknown): value is CtxRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[CTX_REF] === true
  );
}

function readCtxPath(context: any, path: string) {
  return path
    .split('.')
    .reduce((acc, segment) => (acc == null ? acc : acc[segment]), context);
}

// The nested context requirement derived from a ctxRef dot path:
// "inputs.body.user" -> { inputs: { body: { user: unknown } } }.
export type CtxRefReq<TPath extends string> = NestedPathReq<TPath>;

type UnionToIntersection<U> = (
  U extends any ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;

// The combined context requirement of every ctxRef in a filter spec; literal
// (non-ref) values contribute nothing.
type SpecReq<TSpec> =
  UnionToIntersection<
    {
      [K in keyof TSpec]: TSpec[K] extends CtxRef<infer TPath>
        ? CtxRefReq<TPath>
        : never;
    }[keyof TSpec]
  > extends infer TReq
    ? [TReq] extends [never]
      ? {}
      : TReq
    : never;

// A loader filter spec: field -> ctxRef (resolved per request, $eq-wrapped) or
// a literal value (developer-authored, passed through verbatim — literals are
// the escape hatch for operator filters like `{ status: { $in: [...] } }`).
type FilterSpec = Record<string, unknown>;

// ctxRef-resolved values get $eq-wrapped so user-influenced context values
// can't smuggle query operators (NoSQL injection hygiene by default), and
// undefined entries are pruned. Literals pass through verbatim.
function resolveFilterSpec(
  spec: FilterSpec | undefined,
  context: any
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (!spec) {
    return filter;
  }
  for (const field of Object.keys(spec)) {
    const value = spec[field];
    if (isCtxRef(value)) {
      const resolved = readCtxPath(context, value.path);
      if (resolved === undefined) {
        continue;
      }
      filter[field] = { $eq: resolved };
    } else if (value !== undefined) {
      filter[field] = value;
    }
  }
  return filter;
}

function resolveIdSpec(
  idSpec: CtxRef | ((context: any) => unknown),
  context: any
) {
  const id = isCtxRef(idSpec)
    ? readCtxPath(context, idSpec.path)
    : idSpec(context);
  if (id === null || id === undefined || !id.toString()) {
    throw new HipBadInputs('Missing dependent resource ID');
  }
  // A plain object/array here is either a bug or an operator-smuggling
  // attempt (`{"$ne": null}` as an id); ObjectId instances pass fine.
  if (
    typeof id === 'object' &&
    (Array.isArray(id) || (id as object).constructor === Object)
  ) {
    throw new HipBadInputs('Invalid dependent resource ID');
  }
  return id;
}

// Lean reads type as TRaw & { _id } so a downstream stage declaring `_id`
// passes deps-met.
export type LeanDocOf<TRaw> = TRaw & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// Everyday loader fragments. All PascalCase + stage-prefixed, matching the
// core fragment-factory convention.
// ---------------------------------------------------------------------------

/** LoadResources fragment: `Model.find(spec).lean()` -> ctx[key]: Lean<TRaw>[] */
export function LoadManyTo<
  TRaw,
  TKey extends string,
  TSpec extends FilterSpec = {},
>(
  Model: Model<TRaw>,
  key: TKey,
  filterSpec?: TSpec
): {
  loadResources: (
    context: SpecReq<TSpec>
  ) => Promise<Record<TKey, LeanDocOf<TRaw>[]>>;
};
export function LoadManyTo<TRaw, TKey extends string, TCtx extends object>(
  Model: Model<TRaw>,
  key: TKey,
  filterSelector: (context: TCtx) => Record<string, unknown>
): {
  loadResources: (context: TCtx) => Promise<Record<TKey, LeanDocOf<TRaw>[]>>;
};
export function LoadManyTo(
  Model: any,
  key: string,
  filterSpec?: FilterSpec | ((context: any) => Record<string, unknown>)
) {
  return LoadResources(async (context: object) => {
    const filter =
      typeof filterSpec === 'function'
        ? filterSpec(context)
        : resolveFilterSpec(filterSpec, context);
    return { [key]: await Model.find(filter).lean().exec() };
  });
}

/** LoadResources fragment: `Model.findOne(spec).lean()` -> ctx[key]: Lean<TRaw> | null */
export function LoadOneTo<
  TRaw,
  TKey extends string,
  TSpec extends FilterSpec = {},
>(
  Model: Model<TRaw>,
  key: TKey,
  filterSpec?: TSpec
): {
  loadResources: (
    context: SpecReq<TSpec>
  ) => Promise<Record<TKey, LeanDocOf<TRaw> | null>>;
};
export function LoadOneTo<TRaw, TKey extends string, TCtx extends object>(
  Model: Model<TRaw>,
  key: TKey,
  filterSelector: (context: TCtx) => Record<string, unknown>
): {
  loadResources: (
    context: TCtx
  ) => Promise<Record<TKey, LeanDocOf<TRaw> | null>>;
};
export function LoadOneTo(
  Model: any,
  key: string,
  filterSpec?: FilterSpec | ((context: any) => Record<string, unknown>)
) {
  return LoadResources(async (context: object) => {
    const filter =
      typeof filterSpec === 'function'
        ? filterSpec(context)
        : resolveFilterSpec(filterSpec, context);
    return { [key]: await Model.findOne(filter).lean().exec() };
  });
}

/**
 * LoadResources fragment: `Model.findById(id).lean()`, throwing HipNotFound
 * when missing -> ctx[key]: Lean<TRaw>. 404-on-missing is the SHORT pattern.
 */
export function LoadByIdRequiredTo<
  TRaw,
  TKey extends string,
  TPath extends string,
>(
  Model: Model<TRaw>,
  key: TKey,
  idRef: CtxRef<TPath>,
  notFoundMessage?: string
): {
  loadResources: (
    context: CtxRefReq<TPath>
  ) => Promise<Record<TKey, LeanDocOf<TRaw>>>;
};
export function LoadByIdRequiredTo<
  TRaw,
  TKey extends string,
  TCtx extends object,
>(
  Model: Model<TRaw>,
  key: TKey,
  idSelector: (context: TCtx) => unknown,
  notFoundMessage?: string
): {
  loadResources: (context: TCtx) => Promise<Record<TKey, LeanDocOf<TRaw>>>;
};
export function LoadByIdRequiredTo(
  Model: any,
  key: string,
  idSpec: CtxRef | ((context: any) => unknown),
  notFoundMessage?: string
) {
  return LoadResources(async (context: object) => {
    const id = resolveIdSpec(idSpec, context);
    const doc = await Model.findById(id).lean().exec();
    if (!doc) {
      throw new HipNotFound(notFoundMessage ?? 'Resource not found');
    }
    return { [key]: doc };
  });
}

/**
 * LoadResources fragment: `Model.findById(id)` HYDRATED (for update flows that
 * `.set()`/`.save()`), throwing HipNotFound when missing
 * -> ctx[key]: HydratedDocument<TRaw>.
 */
export function LoadDocByIdRequiredTo<
  TRaw,
  TKey extends string,
  TPath extends string,
>(
  Model: Model<TRaw>,
  key: TKey,
  idRef: CtxRef<TPath>,
  notFoundMessage?: string
): {
  loadResources: (
    context: CtxRefReq<TPath>
  ) => Promise<Record<TKey, HydratedDocument<TRaw>>>;
};
export function LoadDocByIdRequiredTo<
  TRaw,
  TKey extends string,
  TCtx extends object,
>(
  Model: Model<TRaw>,
  key: TKey,
  idSelector: (context: TCtx) => unknown,
  notFoundMessage?: string
): {
  loadResources: (
    context: TCtx
  ) => Promise<Record<TKey, HydratedDocument<TRaw>>>;
};
export function LoadDocByIdRequiredTo(
  Model: any,
  key: string,
  idSpec: CtxRef | ((context: any) => unknown),
  notFoundMessage?: string
) {
  return LoadResources(async (context: object) => {
    const id = resolveIdSpec(idSpec, context);
    const doc = await Model.findById(id).exec();
    if (!doc) {
      throw new HipNotFound(notFoundMessage ?? 'Resource not found');
    }
    return { [key]: doc };
  });
}

// ---------------------------------------------------------------------------
// Scoped finders (tenant-scoped list endpoints). PascalCase is the canonical
// naming (matching every other fragment factory); the camelCase names on
// htMongooseFactory remain as aliases.
// ---------------------------------------------------------------------------

// Query options for scoped finders. `queryScope` stays a type-REQUIRED
// context key exactly as before — these only shape the query itself.
export interface ScopedQueryOptions {
  sort?: string | Record<string, SortOrder>;
  limit?: number;
  skip?: number;
  projection?: string | Record<string, unknown>;
  lean?: boolean;
}

export interface FindScopedOptions<
  TKey extends string = 'scopedDocs',
> extends ScopedQueryOptions {
  docsKey?: TKey;
}

function execScopedQuery(
  Model: ModelWithFind,
  filter: Record<string, unknown>,
  options: ScopedQueryOptions
) {
  let query: any =
    options.projection !== undefined
      ? Model.find(filter, options.projection)
      : Model.find(filter);
  if (options.sort !== undefined) {
    query = query.sort(options.sort);
  }
  if (options.skip !== undefined) {
    query = query.skip(options.skip);
  }
  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options.lean) {
    query = query.lean();
  }
  return query.exec();
}

// LoadResources fragment: fetches Model.find with the composed filter
// `{ ...ctx.queryScope, ...extraFilter }` and stores the rows under
// `docsKey`. `queryScope` is REQUIRED in the context type, so the deps-met
// machinery forces some earlier fragment (e.g. a LoadResources contributing
// the caller's tenant filter) to provide it — authorization-as-query-scope
// by construction.
export function LoadScopedTo<TKey extends string>(
  Model: ModelWithFind,
  docsKey: TKey,
  extraFilter?: object,
  options: ScopedQueryOptions = {}
) {
  return LoadResources(async (context: HasQueryScope) => {
    return {
      [docsKey]: await execScopedQuery(
        Model,
        { ...context.queryScope, ...(extraFilter || {}) },
        options
      ),
    } as Record<TKey, any[]>;
  });
}

// The plain list endpoint in one fragment: LoadScopedTo on the load stage
// (so the rows sit in context for finalAuthorize / redactResponse /
// downstream execute stages) plus a trivial execute that returns them.
// Fetching lives on the LOAD stage — piping your own execute after this one
// overrides the response without re-running or wasting the query.
// The third parameter takes an options bag ({ sort, limit, skip, projection,
// lean, docsKey }); a bare string is accepted as the docs key for
// backward compatibility.
export function FindScoped<TKey extends string = 'scopedDocs'>(
  Model: ModelWithFind,
  extraFilter?: object,
  docsKeyOrOptions?: TKey | FindScopedOptions<TKey>
) {
  const options: FindScopedOptions<TKey> =
    typeof docsKeyOrOptions === 'string'
      ? { docsKey: docsKeyOrOptions }
      : (docsKeyOrOptions ?? {});
  const key = (options.docsKey ?? 'scopedDocs') as TKey;
  return {
    ...LoadScopedTo(Model, key, extraFilter, options),
    ...Execute((context: Record<TKey, any[]>) => context[key]),
  };
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

  // Every shape-affecting toObject option pinned to mongoose's defaults, so
  // ambient config (mongoose.set('toObject', ...) or schema-level toObject
  // options) can never alter the shape the sanitizers and redactor produce.
  const pinnedToObjectOptions = {
    getters: false,
    virtuals: false,
    aliases: false,
    versionKey: true,
    depopulate: false,
    flattenMaps: false,
    minimize: true,
  };

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
    // json-mask is loaded lazily so consumers using only the finders/loaders
    // don't need the optional peer installed.
    if (!jsonMaskFn) {
      jsonMaskFn = loadJsonMask();
    }
    return deepWipeDefault(jsonMaskFn(schemaConfigObject, maskConfig));
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
      return doc.toObject({
        ...pinnedToObjectOptions,
        transform: stripIdTransform,
      }) as TSafe;
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
          return doc.toObject({
            ...pinnedToObjectOptions,
            transform: stripIdTransform,
          });
        },
      ])
    ) as {
      [K in keyof TFactories & string]: (
        unsafeSlice: unknown
      ) => ReturnType<ReturnType<TFactories[K]>['toObject']>;
    };
    return SanitizeInputsSlices(sanitizers);
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
      return doc.toObject(pinnedToObjectOptions) as TSafeResponse;
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
    // Everyday loader fragments (also exported at module level — none of them
    // need the mongoose instance; they're on the factory for discoverability).
    ctxRef,
    LoadManyTo,
    LoadOneTo,
    LoadByIdRequiredTo,
    LoadDocByIdRequiredTo,
    // Scoped finders. PascalCase is canonical; the camelCase names are
    // backward-compatible aliases.
    FindScoped,
    LoadScopedTo,
    findScoped: FindScoped,
    loadScopedTo: LoadScopedTo,
    stripIdTransform,
  };
}
