import Boom from '@hapi/boom';
import {
  AttachDataReqsSatisfiedOptional,
  DoWorkReqsSatisfiedOptional,
  FinalAuthReqsSatisfied,
  HasAllNotRequireds,
  HasAllRequireds,
  HasAllStagesNotOptionals,
  HasAttachData,
  HasDoWork,
  HasExtractInputs,
  HasFinalAuthorize,
  HasInitPreContext,
  HasPreAuthorize,
  HasSanitizeInputs,
  HasSanitizeResponse,
  MightHaveFinalAuthorize,
  MightHavePreAuthorize,
  MightHaveSanitizeResponse,
  OptionallyHasAttachData,
  OptionallyHasDoWork,
  OptionallyHasExtractInputs,
  OptionallyHasInitPreContext,
  OptionallyHasSanitizeInputs,
  PreAuthReqsSatisfied,
  PromiseOrSync,
  PromiseResolveOrSync,
  SanitizeResponseReqsSatisfied,
} from './types';

export function withDefaultImplementations<
  TStrategy extends HasAllNotRequireds &
    HasAllRequireds &
    PreAuthReqsSatisfied<TStrategy> &
    AttachDataReqsSatisfiedOptional<TStrategy> &
    FinalAuthReqsSatisfied<TStrategy> &
    DoWorkReqsSatisfiedOptional<TStrategy> &
    SanitizeResponseReqsSatisfied<TStrategy>
>(strategy: TStrategy): HasAllStagesNotOptionals {
  return {
    ...(strategy as any),
    initPreContext:
      strategy.initPreContext ||
      (() => {
        return {};
      }),
    extractInputs: strategy.extractInputs || ((raw: any) => raw),
    sanitizeInputs: strategy.sanitizeInputs,
    preAuthorize: strategy.preAuthorize,
    attachData:
      strategy.attachData ||
      (() => {
        return {};
      }),
    finalAuthorize: strategy.finalAuthorize,
    doWork: strategy.doWork,
    sanitizeResponse: strategy.sanitizeResponse,
  };
}

export function isHasInitPreContext<TContextIn, TContextOut>(
  thing: OptionallyHasInitPreContext<TContextIn, TContextOut>
): thing is HasInitPreContext<TContextIn, TContextOut> {
  return !!(thing && thing.initPreContext);
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
  thing: MightHavePreAuthorize<TContextIn, TContextOut>
): thing is HasPreAuthorize<TContextIn, TContextOut> {
  return !!(thing && thing.preAuthorize);
}

export function isHasAttachData<TContextIn, TContextOut>(
  thing: OptionallyHasAttachData<TContextIn, TContextOut>
): thing is HasAttachData<TContextIn, TContextOut> {
  return !!(thing && thing.attachData);
}

export function isHasFinalAuthorize<TContextIn, TContextOut>(
  thing: MightHaveFinalAuthorize<TContextIn, TContextOut>
): thing is HasFinalAuthorize<TContextIn, TContextOut> {
  return !!(thing && thing.finalAuthorize);
}

export function isHasDoWork<TContextIn, TContextOut>(
  thing: OptionallyHasDoWork<TContextIn, TContextOut>
): thing is HasDoWork<TContextIn, TContextOut> {
  return !!(thing && thing.doWork);
}

export function isHasSanitizeResponse<TContextIn, TContextOut>(
  thing: MightHaveSanitizeResponse<TContextIn, TContextOut>
): thing is HasSanitizeResponse<TContextIn, TContextOut> {
  return !!(thing && thing.sanitizeResponse);
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
  TConf extends HasAllStagesNotOptionals &
    PreAuthReqsSatisfied<TConf> &
    AttachDataReqsSatisfiedOptional<TConf> &
    FinalAuthReqsSatisfied<TConf> &
    DoWorkReqsSatisfiedOptional<TConf> &
    SanitizeResponseReqsSatisfied<TConf> &
    HasSuccessStatus,
  TRaw
>(requestHandler: TConf, raw: TRaw, defaultStatus: number = 200) {
  const badDataThrow = Boom.badData('User input sanitization failure');

  const safePreContext = transformThrowSync(
    badDataThrow,
    requestHandler.initPreContext,
    raw
  );

  const preContextSlot = { preContext: safePreContext };

  const unsafeInputs = transformThrowSync(
    badDataThrow,
    requestHandler.extractInputs,
    { ...(raw as any), ...preContextSlot }
  );

  const safeInputs = transformThrowSync(
    badDataThrow,
    requestHandler.sanitizeInputs,
    unsafeInputs
  );

  const inputsContext = {
    preContext: safePreContext,
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
      requestHandler.attachData,
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
      requestHandler.doWork(finalAuthContext)
    );

    const safeResponse = requestHandler.sanitizeResponse(unsafeResponse);

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
  requestHandler: HasAllRequireds & Record<string, any>
) {
  const requiredMethods = [
    'sanitizeInputs',
    'preAuthorize',
    'finalAuthorize',
    'doWork',
    'sanitizeResponse',
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
