import {
  NextFunction as ExpressNextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import {
  assertHipthrustable,
  executeHipthrustable,
  HipRedirectException,
  withDefaultImplementations,
} from './core';
import {
  AttachDataReqsSatisfiedOptional,
  DoWorkReqsSatisfiedOptional,
  FinalAuthReqsSatisfied,
  HasAllNotRequireds,
  HasAllRequireds,
  HipWorkResponse,
  PreAuthReqsSatisfied,
  PromiseOrSync,
  PromiseResolveOrSync,
  RespondReqsSatisfied,
  SanitizeResponseReqsSatisfied,
} from './types';

// Type for handler config with computed context types that enable inference
// Note: TParams, TBody, etc. represent the RAW return type (possibly Promise-wrapped)
// The context types use PromiseResolveOrSync to unwrap them
type ExpressHandlerConfig<
  TParams = never,
  TBody = never,
  TQueryParams = never,
  TPreContext = never,
  TPreAuthOut = unknown,
  TAttachDataOut = unknown,
  TFinalAuthOut = unknown,
  TDoWorkOut = unknown,
  TResponse = unknown
> = {
  initPreContext?: (unsafe: any) => TPreContext;
  sanitizeParams?: (i: { params: any }) => TParams;
  sanitizeBody?: (i: { body: any }) => TBody;
  sanitizeQueryParams?: (i: { queryParams: any }) => TQueryParams;
  preAuthorize: (
    context: ([TParams] extends [never] ? {} : { params: PromiseResolveOrSync<TParams> }) &
      ([TBody] extends [never] ? {} : { body: PromiseResolveOrSync<TBody> }) &
      ([TQueryParams] extends [never] ? {} : { queryParams: PromiseResolveOrSync<TQueryParams> }) &
      ([TPreContext] extends [never] ? {} : { preContext: TPreContext })
  ) => TPreAuthOut;
  attachData?: (
    context: ([TParams] extends [never] ? {} : { params: PromiseResolveOrSync<TParams> }) &
      ([TBody] extends [never] ? {} : { body: PromiseResolveOrSync<TBody> }) &
      ([TQueryParams] extends [never] ? {} : { queryParams: PromiseResolveOrSync<TQueryParams> }) &
      ([TPreContext] extends [never] ? {} : { preContext: TPreContext }) &
      PromiseResolveOrSync<TPreAuthOut>
  ) => PromiseOrSync<TAttachDataOut>;
  finalAuthorize: (
    context: ([TParams] extends [never] ? {} : { params: PromiseResolveOrSync<TParams> }) &
      ([TBody] extends [never] ? {} : { body: PromiseResolveOrSync<TBody> }) &
      ([TQueryParams] extends [never] ? {} : { queryParams: PromiseResolveOrSync<TQueryParams> }) &
      ([TPreContext] extends [never] ? {} : { preContext: TPreContext }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TAttachDataOut>
  ) => PromiseOrSync<TFinalAuthOut>;
  doWork?: (
    context: ([TParams] extends [never] ? {} : { params: PromiseResolveOrSync<TParams> }) &
      ([TBody] extends [never] ? {} : { body: PromiseResolveOrSync<TBody> }) &
      ([TQueryParams] extends [never] ? {} : { queryParams: PromiseResolveOrSync<TQueryParams> }) &
      ([TPreContext] extends [never] ? {} : { preContext: TPreContext }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TAttachDataOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<TDoWorkOut>;
  respond: (
    context: ([TParams] extends [never] ? {} : { params: PromiseResolveOrSync<TParams> }) &
      ([TBody] extends [never] ? {} : { body: PromiseResolveOrSync<TBody> }) &
      ([TQueryParams] extends [never] ? {} : { queryParams: PromiseResolveOrSync<TQueryParams> }) &
      ([TPreContext] extends [never] ? {} : { preContext: TPreContext }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TAttachDataOut> &
      PromiseResolveOrSync<TFinalAuthOut> &
      PromiseResolveOrSync<TDoWorkOut>
  ) => HipWorkResponse<TResponse>;
  sanitizeResponse: (r: { response: TResponse }) => any;
};

// The output type that's compatible with hipExpressHandlerFactory and HTPipe
type InferredHandlerConfig = HasAllNotRequireds & HasAllRequireds;

// Identity function - returns input unchanged, but enables TypeScript to infer types
// The return type is cast to be compatible with hipExpressHandlerFactory while
// preserving the inference benefits at the call site
export const defineExpressHandler = <
  TParams = never,
  TBody = never,
  TQueryParams = never,
  TPreContext = never,
  TPreAuthOut = unknown,
  TAttachDataOut = unknown,
  TFinalAuthOut = unknown,
  TDoWorkOut = unknown,
  TResponse = unknown
>(
  config: ExpressHandlerConfig<
    TParams,
    TBody,
    TQueryParams,
    TPreContext,
    TPreAuthOut,
    TAttachDataOut,
    TFinalAuthOut,
    TDoWorkOut,
    TResponse
  >
): InferredHandlerConfig => config as InferredHandlerConfig;

export function hipExpressHandlerFactory<
  TConf extends HasAllNotRequireds &
    HasAllRequireds &
    PreAuthReqsSatisfied<TConf> &
    AttachDataReqsSatisfiedOptional<TConf> &
    FinalAuthReqsSatisfied<TConf> &
    DoWorkReqsSatisfiedOptional<TConf> &
    RespondReqsSatisfied<TConf> &
    SanitizeResponseReqsSatisfied<TConf>
>(handlingStrategy: TConf) {
  assertHipthrustable(handlingStrategy);
  const fullHipthrustable = withDefaultImplementations(handlingStrategy);
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNextFunction
  ) => {
    try {
      const { response, status } = await executeHipthrustable(
        fullHipthrustable,
        { req, res },
        req.params,
        req.query,
        req.body
      );
      res.status(status).json(response);
    } catch (exception) {
      if (exception instanceof HipRedirectException) {
        res.redirect(exception.redirectCode, exception.redirectUrl);
      } else {
        next(exception);
      }
    }
  };
}
