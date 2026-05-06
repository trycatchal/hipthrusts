import {
  assertHipthrustable,
  withDefaultImplementations,
} from './core';
import {
  AttachDataReqsSatisfiedOptional,
  DoWorkReqsSatisfiedOptional,
  FinalAuthReqsSatisfied,
  HasAllNotRequireds,
  HasAllRequireds,
  HasAllStagesNotOptionals,
  HipWorkResponse,
  PreAuthReqsSatisfied,
  PromiseOrSync,
  PromiseResolveOrSync,
  RespondReqsSatisfied,
  SanitizeResponseReqsSatisfied,
} from './types';

// ── Factory constraint ─────────────────────────────────────────────────
// These are re-exported so adapters can write their factory generic bound
// without importing from ./types directly.

export type {
  AttachDataReqsSatisfiedOptional,
  DoWorkReqsSatisfiedOptional,
  FinalAuthReqsSatisfied,
  HasAllNotRequireds,
  HasAllRequireds,
  PreAuthReqsSatisfied,
  RespondReqsSatisfied,
  SanitizeResponseReqsSatisfied,
} from './types';

// ── Handler config type ────────────────────────────────────────────────
// Shared type inference helper for defining handlers. Each generic
// represents the output of one lifecycle stage. The conditional
// intersections ensure each stage only sees data from prior stages.

export type HandlerConfig<
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

// ── Shared helpers ─────────────────────────────────────────────────────

export type InferredHandlerConfig = HasAllNotRequireds & HasAllRequireds;

/**
 * Identity function that enables TypeScript to infer all 9 generic
 * parameters from the handler config you write. Adapters re-export
 * this under framework-specific names (defineExpressHandler, etc.).
 */
export const defineHandler = <
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
  config: HandlerConfig<
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

/**
 * Validates and fills in defaults for a handler config. Call this once
 * at factory setup time (import time), not per request.
 */
export function prepareHipthrustable<
  TConf extends HasAllNotRequireds &
    HasAllRequireds &
    PreAuthReqsSatisfied<TConf> &
    AttachDataReqsSatisfiedOptional<TConf> &
    FinalAuthReqsSatisfied<TConf> &
    DoWorkReqsSatisfiedOptional<TConf> &
    RespondReqsSatisfied<TConf> &
    SanitizeResponseReqsSatisfied<TConf>
>(
  handlingStrategy: TConf
): HasAllStagesNotOptionals {
  assertHipthrustable(handlingStrategy);
  return withDefaultImplementations(handlingStrategy);
}
