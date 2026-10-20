import {
  HipBadInputs,
  HipError,
  HipForbidden,
  HipInternal,
  HipRedirect,
  INTERNAL_ERROR_MESSAGE,
  isHipError,
} from './errors.js';
import {
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  HasAllStagesDefined,
  HasExecute,
  HasExtractAmbient,
  HasExtractInputs,
  HasFinalAuthorize,
  HasLoadResources,
  HasPreAuthorize,
  HasRedactResponse,
  HasRequiredStages,
  HasSanitizeInputs,
  LoadResourcesDepsMet,
  OptionallyHasExecute,
  OptionallyHasExtractAmbient,
  OptionallyHasExtractInputs,
  OptionallyHasFinalAuthorize,
  OptionallyHasLoadResources,
  OptionallyHasPreAuthorize,
  OptionallyHasRedactResponse,
  OptionallyHasSanitizeInputs,
  OptionalStagesShape,
  PreAuthorizeDepsMet,
  PromiseOrSync,
  PromiseResolveOrSync,
  RedactResponseDepsMet,
  ReservedKeysUnshadowed,
  DeferredTask,
  ETagResult,
  ReservedContextKey,
  UNSAFE_SLICES,
} from './types.js';

export function withDefaultImplementations<
  TStrategy extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TStrategy> &
    LoadResourcesDepsMet<TStrategy> &
    FinalAuthorizeDepsMet<TStrategy> &
    ExecuteDepsMet<TStrategy> &
    RedactResponseDepsMet<TStrategy> &
    ReservedKeysUnshadowed<TStrategy>,
>(strategy: TStrategy): HasAllStagesDefined {
  return {
    ...(strategy as any),
    extractAmbient:
      strategy.extractAmbient ||
      (() => {
        return {};
      }),
    extractInputs: strategy.extractInputs || ((raw: any) => raw),
    sanitizeInputs: strategy.sanitizeInputs,
    preAuthorize: strategy.preAuthorize,
    loadResources:
      strategy.loadResources ||
      (() => {
        return {};
      }),
    finalAuthorize: strategy.finalAuthorize,
    execute: strategy.execute,
    redactResponse: strategy.redactResponse,
  };
}

export function isHasExtractAmbient<TContextIn, TContextOut>(
  thing: OptionallyHasExtractAmbient<TContextIn, TContextOut>
): thing is HasExtractAmbient<TContextIn, TContextOut> {
  return !!(thing && thing.extractAmbient);
}

export function isHasExtractInputs<TContextIn, TContextOut>(
  thing: OptionallyHasExtractInputs<TContextIn, TContextOut>
): thing is HasExtractInputs<TContextIn, TContextOut> {
  return !!(thing && thing.extractInputs);
}

export function isHasSanitizeInputs<TContextIn, TContextOut>(
  thing: OptionallyHasSanitizeInputs<TContextIn, TContextOut>
): thing is HasSanitizeInputs<TContextIn, TContextOut> {
  return !!(thing && thing.sanitizeInputs);
}

export function isHasPreAuthorize<TContextIn, TContextOut>(
  thing: OptionallyHasPreAuthorize<TContextIn, TContextOut>
): thing is HasPreAuthorize<TContextIn, TContextOut> {
  return !!(thing && thing.preAuthorize);
}

export function isHasLoadResources<TContextIn, TContextOut>(
  thing: OptionallyHasLoadResources<TContextIn, TContextOut>
): thing is HasLoadResources<TContextIn, TContextOut> {
  return !!(thing && thing.loadResources);
}

export function isHasFinalAuthorize<TContextIn, TContextOut>(
  thing: OptionallyHasFinalAuthorize<TContextIn, TContextOut>
): thing is HasFinalAuthorize<TContextIn, TContextOut> {
  return !!(thing && thing.finalAuthorize);
}

export function isHasExecute<TContextIn, TContextOut>(
  thing: OptionallyHasExecute<TContextIn, TContextOut>
): thing is HasExecute<TContextIn, TContextOut> {
  return !!(thing && thing.execute);
}

export function isHasRedactResponse<TContextIn, TContextOut>(
  thing: OptionallyHasRedactResponse<TContextIn, TContextOut>
): thing is HasRedactResponse<TContextIn, TContextOut> {
  return !!(thing && thing.redactResponse);
}

// An authorization stage passes by returning `true` or ANY object (an object
// also contributes its keys to the shared context). Only `false` (or a falsy
// non-object) denies. An empty object `{}` PASSES — it just contributes nothing.
export function authorizationPassed<TAuthOut extends boolean | object>(
  authOut: TAuthOut
) {
  return authOut === true || (!!authOut && typeof authOut === 'object');
}

function transformThrowSync<TOrigFn extends (param: any) => any>(
  toThrow: (cause: unknown) => HipError,
  origFn: TOrigFn,
  origParam: Parameters<TOrigFn>[0]
): ReturnType<TOrigFn> {
  try {
    return origFn(origParam);
  } catch (exception) {
    if (exception instanceof HipRedirect || isHipError(exception)) {
      throw exception;
    } else {
      throw toThrow(exception);
    }
  }
}

async function transformThrowPossiblyAsync<
  TOrigFn extends (param: any) => PromiseOrSync<any>,
>(
  toThrow: (cause: unknown) => HipError,
  origFn: TOrigFn,
  origParam: Parameters<TOrigFn>[0]
): Promise<PromiseResolveOrSync<ReturnType<TOrigFn>>> {
  try {
    return await Promise.resolve(origFn(origParam));
  } catch (exception) {
    if (exception instanceof HipRedirect || isHipError(exception)) {
      throw exception;
    } else {
      throw toThrow(exception);
    }
  }
}

// Defined next to `HipInternal`, whose default message it is; re-exported here
// because this is where it has always been imported from.
export { INTERNAL_ERROR_MESSAGE };

const internalFrom = (cause: unknown) =>
  new HipInternal(INTERNAL_ERROR_MESSAGE, undefined, { cause });

const RESERVED_CONTEXT_KEYS: ReservedContextKey[] = ['defer'];

// Runtime half of ReservedKeysUnshadowed: a stage contribution may never
// replace a key the lifecycle provides (an `any`-typed stage slips past the
// type check, so this is not redundant).
function assertNoReservedKeys(stage: string, contribution: unknown) {
  if (contribution === null || typeof contribution !== 'object') {
    return;
  }
  for (const key of RESERVED_CONTEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(contribution, key)) {
      throw new HipInternal(INTERNAL_ERROR_MESSAGE, {
        reason: `${stage} returned the reserved context key "${key}"`,
      });
    }
  }
}

// The per-request queue behind `ctx.defer`. Adapters drain it once, after the
// response is sent; draining seals it, so a late `defer` call (e.g. from
// afterResponse, or a floating promise) throws instead of silently dropping
// the task.
export interface DeferQueue {
  readonly size: number;
  drain(): DeferredTask[];
}

function createDeferQueue() {
  const tasks: DeferredTask[] = [];
  let sealed = false;
  const defer = (task: DeferredTask) => {
    if (typeof task !== 'function') {
      throw new TypeError('ctx.defer() expects a function');
    }
    if (sealed) {
      throw new Error(
        'ctx.defer() was called after the response was sent; deferred tasks must be registered during the lifecycle'
      );
    }
    tasks.push(task);
  };
  const queue: DeferQueue = {
    get size() {
      return tasks.length;
    },
    drain() {
      sealed = true;
      return tasks.splice(0);
    },
  };
  return { defer, queue };
}

// Transport-specific hooks a caller (an adapter) may hand the lifecycle.
export interface LifecycleOptions {
  // Turns the handler's `etag` stage output into the formatted header value
  // and decides whether the request's validators match it. When absent (tRPC,
  // non-GET/HEAD requests) the `etag` stage is not run at all.
  resolveETag?: (tag: Exclude<ETagResult, null | undefined>) => {
    etag: string;
    notModified: boolean;
  };
}

// The successful outcome of a lifecycle run. `notModified: true` means the
// `etag` stage matched: execute and redactResponse were skipped, there is no
// response body, and `context` is the context execute would have received.
export type LifecycleResult =
  | {
      notModified: false;
      response: unknown;
      context: Record<string, any>;
      etag: string | undefined;
      deferred: DeferQueue;
    }
  | {
      notModified: true;
      response: undefined;
      context: Record<string, any>;
      etag: string;
      deferred: DeferQueue;
    };

// Runs the full lifecycle and returns the safe response plus the final context
// (inputs/ambient/loaded resources/auth output/execute output/response). The
// context is transport-agnostic; adapters use it to derive their own response
// metadata (e.g. HTTP status/headers via `responseMeta`).
export async function executeHipthrustable<
  TConf extends HasAllStagesDefined &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    ReservedKeysUnshadowed<TConf>,
  TRaw,
>(
  requestHandler: TConf,
  raw: TRaw,
  options: LifecycleOptions = {}
): Promise<LifecycleResult> {
  const { defer, queue: deferred } = createDeferQueue();

  // Unknown throws during input handling stay 422: these stages exist to
  // reject untrusted input, and validators (zod .parse etc.) throw their own
  // library errors. The original error is chained as `cause` for logging.
  const badDataThrow = (cause: unknown) =>
    new HipBadInputs('User input sanitization failure', undefined, { cause });

  // `extractAmbient` is the FIRST stage and never sees validated input — it
  // lifts trusted ambient (auth principal, request id, locale) off the raw
  // request. An UNKNOWN throw here is therefore an app bug or infra failure,
  // NOT a client-attributable input problem: route it to 500, exactly like
  // `preAuthorize`/`loadResources` below, so outages don't masquerade as a
  // caller's bad input. A deliberate 401 stays expressible by throwing
  // `HipUnauthorized` (or any HipError), which passes through unwrapped.
  const safeAmbient = transformThrowSync(
    internalFrom,
    requestHandler.extractAmbient,
    raw
  );

  const ambientSlot = { ambient: safeAmbient };

  const unsafeInputs = transformThrowSync(
    badDataThrow,
    requestHandler.extractInputs,
    { ...(raw as any), ...ambientSlot }
  );

  const sanitizeOutput = transformThrowSync(
    badDataThrow,
    requestHandler.sanitizeInputs,
    unsafeInputs
  );

  // The strictness guarantee: slice-style sanitizers pass the raw remainder
  // to each other under UNSAFE_SLICES, and it dies HERE — nothing reaches
  // later stages except what a sanitizer explicitly returned.
  let safeInputs = sanitizeOutput;
  if (
    safeInputs !== null &&
    typeof safeInputs === 'object' &&
    UNSAFE_SLICES in safeInputs
  ) {
    safeInputs = { ...(safeInputs as object) };
    delete (safeInputs as Record<PropertyKey, unknown>)[UNSAFE_SLICES];
  }

  const inputsContext = {
    ambient: safeAmbient,
    inputs: safeInputs,
    defer,
  };

  const forbiddenPreAuthThrow = new HipForbidden(
    'General pre-authorization lacking for this resource'
  );

  // Denial (returning/throwing an authorization outcome) is 403; an UNKNOWN
  // throw here is an app bug or infra failure, not a denial — route it to 500
  // so outages don't masquerade as authorization results.
  const preAuthorizeResult = transformThrowSync(
    internalFrom,
    requestHandler.preAuthorize,
    inputsContext
  );

  const preAuthorizePassed = authorizationPassed(preAuthorizeResult);

  if (!preAuthorizePassed) {
    throw forbiddenPreAuthThrow;
  }

  const preAuthorizeContextOut =
    preAuthorizeResult === true ? {} : preAuthorizeResult;
  assertNoReservedKeys('preAuthorize', preAuthorizeContextOut);

  const preAuthContext = {
    ...inputsContext,
    ...preAuthorizeContextOut,
  };

  // 404 is a DELIBERATE signal: throw HipNotFound (e.g. via findByIdRequired)
  // when a required resource is missing. An unknown throw here — a dropped DB
  // connection, a bug — becomes a 500 with the original error chained as
  // `cause`, so infra failures no longer masquerade as "not found".
  const attachedDataContextOnly =
    (await transformThrowPossiblyAsync(
      internalFrom,
      requestHandler.loadResources,
      preAuthContext
    )) || {};
  assertNoReservedKeys('loadResources', attachedDataContextOnly);
  const attachedDataContext = { ...preAuthContext, ...attachedDataContextOnly };

  const forbiddenFinalAuthThrow = new HipForbidden(
    'General authorization lacking for this resource'
  );

  const finalAuthorizeResult = await transformThrowPossiblyAsync(
    internalFrom,
    requestHandler.finalAuthorize,
    attachedDataContext
  );

  const finalAuthorizePassed = authorizationPassed(
    finalAuthorizeResult as object | boolean
  );

  if (!finalAuthorizePassed) {
    throw forbiddenFinalAuthThrow;
  }

  const finalAuthorizeContextOut =
    finalAuthorizeResult === true ? {} : (finalAuthorizeResult as object);
  assertNoReservedKeys('finalAuthorize', finalAuthorizeContextOut);

  const finalAuthContext = {
    ...attachedDataContext,
    ...finalAuthorizeContextOut,
  };

  // Conditional GET. Placement is the security property: this runs only
  // after BOTH authorization stages passed, so a 304 can never tell an
  // unauthorized caller "this exists and is unchanged".
  let etag: string | undefined;
  const etagStage = (requestHandler as { etag?: unknown }).etag;
  if (options.resolveETag && typeof etagStage === 'function') {
    const tag = (await transformThrowPossiblyAsync(
      internalFrom,
      etagStage as (context: any) => unknown,
      finalAuthContext
    )) as ETagResult;
    if (tag !== null && tag !== undefined) {
      const resolved = options.resolveETag(tag);
      etag = resolved.etag;
      if (resolved.notModified) {
        return {
          notModified: true,
          response: undefined,
          context: finalAuthContext,
          etag: resolved.etag,
          deferred,
        };
      }
    }
  }

  try {
    const unsafeResponse = await Promise.resolve(
      requestHandler.execute(finalAuthContext)
    );

    const safeResponse = requestHandler.redactResponse(
      unsafeResponse,
      finalAuthContext
    );

    // `defer` is re-applied last: execute's output keys are response data
    // and may legitimately be named anything, but they must not replace the
    // lifecycle's own `defer` on the final context.
    const context =
      unsafeResponse !== null && typeof unsafeResponse === 'object'
        ? {
            ...finalAuthContext,
            ...(unsafeResponse as object),
            response: safeResponse,
            defer,
          }
        : { ...finalAuthContext, response: safeResponse };

    return {
      notModified: false,
      response: safeResponse,
      context,
      etag,
      deferred,
    };
  } catch (exception) {
    if (exception instanceof HipRedirect || isHipError(exception)) {
      throw exception;
    } else {
      throw internalFrom(exception);
    }
  }
}

export function assertHipthrustable(
  requestHandler: HasRequiredStages & Record<string, any>
) {
  const requiredMethods = [
    'sanitizeInputs',
    'preAuthorize',
    'finalAuthorize',
    'execute',
    'redactResponse',
  ];
  requiredMethods.forEach((method) => {
    if (
      !requestHandler[method] ||
      typeof requestHandler[method] !== 'function'
    ) {
      throw new Error(
        `Missing instance method "${method}" on supposedly hipthrustable class`
      );
    }
  });
}
