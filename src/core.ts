import Boom from '@hapi/boom';
import {
  LoadResourcesDepsMet,
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  OptionalStagesShape,
  HasRequiredStages,
  HasAllStagesDefined,
  HasLoadResources,
  HasExecute,
  HasExtractInputs,
  HasFinalAuthorize,
  HasExtractAmbient,
  HasPreAuthorize,
  HasSanitizeInputs,
  HasRedactResponse,
  OptionallyHasFinalAuthorize,
  OptionallyHasPreAuthorize,
  OptionallyHasRedactResponse,
  OptionallyHasLoadResources,
  OptionallyHasExecute,
  OptionallyHasExtractInputs,
  OptionallyHasExtractAmbient,
  OptionallyHasSanitizeInputs,
  PreAuthorizeDepsMet,
  PromiseOrSync,
  PromiseResolveOrSync,
  RedactResponseDepsMet,
} from './types';

export function withDefaultImplementations<
  TStrategy extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TStrategy> &
    LoadResourcesDepsMet<TStrategy> &
    FinalAuthorizeDepsMet<TStrategy> &
    ExecuteDepsMet<TStrategy> &
    RedactResponseDepsMet<TStrategy>
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

export function authorizationPassed<TAuthOut extends boolean | object>(
  authOut: TAuthOut
) {
  return (
    authOut === true ||
    (authOut && typeof authOut === 'object' && Object.keys(authOut).length > 0)
  );
}

export class HipRedirectException {
  constructor(
    public readonly redirectUrl: string,
    public readonly redirectCode = 302
  ) {}
}

function transformThrowSync<TOrigFn extends (param: any) => any>(
  toThrow: any,
  origFn: TOrigFn,
  origParam: Parameters<TOrigFn>[0]
): ReturnType<TOrigFn> {
  try {
    return origFn(origParam);
  } catch (exception) {
    if (exception instanceof HipRedirectException || Boom.isBoom(exception)) {
      throw exception;
    } else {
      throw toThrow;
    }
  }
}

function transformThrowPossiblyAsync<
  TOrigFn extends (param: any) => PromiseOrSync<any>
>(
  toThrow: any,
  origFn: TOrigFn,
  origParam: Parameters<TOrigFn>[0]
): Promise<PromiseResolveOrSync<ReturnType<TOrigFn>>> {
  return Promise.resolve(origFn(origParam)).catch(exception => {
    if (exception instanceof HipRedirectException || Boom.isBoom(exception)) {
      throw exception;
    } else {
      throw toThrow;
    }
  });
}

export type SuccessStatus<TCtx = any> = number | ((ctx: TCtx) => number);

export interface HasSuccessStatus<TCtx = any> {
  successStatus?: SuccessStatus<TCtx>;
}

function resolveSuccessStatus(
  successStatus: SuccessStatus | undefined,
  ctx: any,
  fallback: number
): number {
  if (typeof successStatus === 'number') {
    return successStatus;
  }
  if (typeof successStatus === 'function') {
    return successStatus(ctx);
  }
  return fallback;
}

export async function executeHipthrustable<
  TConf extends HasAllStagesDefined &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    HasSuccessStatus,
  TRaw
>(requestHandler: TConf, raw: TRaw, defaultStatus: number = 200) {
  const badDataThrow = Boom.badData('User input sanitization failure');

  const safeAmbient = transformThrowSync(
    badDataThrow,
    requestHandler.extractAmbient,
    raw
  );

  const ambientSlot = { ambient: safeAmbient };

  const unsafeInputs = transformThrowSync(
    badDataThrow,
    requestHandler.extractInputs,
    { ...(raw as any), ...ambientSlot }
  );

  const safeInputs = transformThrowSync(
    badDataThrow,
    requestHandler.sanitizeInputs,
    unsafeInputs
  );

  const inputsContext = {
    ambient: safeAmbient,
    inputs: safeInputs,
  };

  const forbiddenPreAuthThrow = Boom.forbidden(
    'General pre-authorization lacking for this resource'
  );

  const preAuthorizeResult = transformThrowSync(
    forbiddenPreAuthThrow,
    requestHandler.preAuthorize,
    inputsContext
  );

  const preAuthorizePassed = authorizationPassed(preAuthorizeResult);

  if (!preAuthorizePassed) {
    throw forbiddenPreAuthThrow;
  }

  const preAuthorizeContextOut =
    preAuthorizeResult === true ? {} : preAuthorizeResult;

  const preAuthContext = {
    ...inputsContext,
    ...preAuthorizeContextOut,
  };

  const notFoundThrow = Boom.notFound('Resource not found');
  const attachedDataContextOnly =
    (await transformThrowPossiblyAsync(
      notFoundThrow,
      requestHandler.loadResources,
      preAuthContext
    )) || {};
  const attachedDataContext = { ...preAuthContext, ...attachedDataContextOnly };

  const forbiddenFinalAuthThrow = Boom.forbidden(
    'General authorization lacking for this resource'
  );

  const finalAuthorizeResult = await transformThrowPossiblyAsync(
    forbiddenFinalAuthThrow,
    requestHandler.finalAuthorize,
    attachedDataContext
  );

  const finalAuthorizePassed = authorizationPassed(
    finalAuthorizeResult as object | boolean
  );

  if (!finalAuthorizePassed) {
    throw forbiddenPreAuthThrow;
  }

  const finalAuthorizeContextOut =
    finalAuthorizeResult === true ? {} : (finalAuthorizeResult as object);

  const finalAuthContext = {
    ...attachedDataContext,
    ...finalAuthorizeContextOut,
  };

  try {
    const unsafeResponse = await Promise.resolve(
      requestHandler.execute(finalAuthContext)
    );

    const safeResponse = requestHandler.redactResponse(unsafeResponse);

    const successCtx =
      unsafeResponse !== null && typeof unsafeResponse === 'object'
        ? {
            ...finalAuthContext,
            ...(unsafeResponse as object),
            response: safeResponse,
          }
        : { ...finalAuthContext, response: safeResponse };

    const status = resolveSuccessStatus(
      (requestHandler as HasSuccessStatus).successStatus,
      successCtx,
      defaultStatus
    );

    return { response: safeResponse, status };
  } catch (exception) {
    if (exception instanceof HipRedirectException || Boom.isBoom(exception)) {
      throw exception;
    } else {
      throw Boom.badImplementation('Uncaught exception');
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
  requiredMethods.forEach(method => {
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
