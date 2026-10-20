import { NextFunction, Request, Response } from 'express';
import {
  assertHipthrustable,
  executeHipthrustable,
  LifecycleResult,
  withDefaultImplementations,
} from './core.js';
import {
  hipErrorToBody,
  hipErrorToStatus,
  HipRedirect,
  isHipError,
} from './errors.js';
import {
  FinallyInfo,
  HasResponseMeta,
  httpLifecycleOptions,
  HttpAdapterOptions,
  makeAfterResponseRunner,
  ResponseMeta,
  responseHeaders,
  safeInvokeOnError,
} from './http-adapter.js';
import {
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  HasRequiredStages,
  LoadResourcesDepsMet,
  OptionalStagesShape,
  PreAuthorizeDepsMet,
  ETagResult,
  HasDefer,
  PromiseOrSync,
  PromiseResolveOrSync,
  RedactResponseDepsMet,
  ReservedKeysUnshadowed,
} from './types.js';

// Canonical input shape produced by the express adapter baseline extractInputs.
export interface ExpressRawInputs {
  params: any;
  query: any;
  body: any;
  headers: any;
}

export interface ExpressRaw {
  req: Request;
  res: Response;
}

export interface HipExpressHandlerOptions extends HttpAdapterOptions {
  // By default the adapter responds to errors directly (status +
  // { error, issues?, detail? }), matching the other HTTP adapters. Set true
  // to instead forward every error — the HipError itself, or the raw unknown
  // exception — to next() so your own express error middleware handles it
  // (use hipErrorToStatus/hipErrorToBody from 'hipthrusts/errors' there).
  delegateErrors?: boolean;
}

// Handler config the dev writes for an express endpoint.
// `extractInputs` chains AFTER the adapter baseline; if omitted, the canonical
// {params, query, body, headers} shape flows directly to sanitizeInputs.
type ExpressHandlerConfig<
  TInputs = ExpressRawInputs,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown,
> = {
  extractAmbient?: (raw: ExpressRaw) => TAmbient;
  extractInputs?: (canonical: ExpressRawInputs) => TInputs;
  sanitizeInputs: (unsafe: TInputs) => TSafeInputs;
  preAuthorize: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient })
  ) => TPreAuthOut;
  loadResources?: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut>
  ) => PromiseOrSync<TLoadResourcesOut>;
  finalAuthorize: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut>
  ) => PromiseOrSync<TFinalAuthOut>;
  execute: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<TUnsafeResponse>;
  redactResponse: (
    unsafe: PromiseResolveOrSync<TUnsafeResponse>,
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => TResponse;
  etag?: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<ETagResult>;
  responseMeta?: ResponseMeta | ((ctx: any) => ResponseMeta);
};

type InferredHandlerConfig = OptionalStagesShape &
  HasRequiredStages &
  HasResponseMeta;

// Identity function for inference-friendly config authoring.
export const defineExpressHandler = <
  TInputs = ExpressRawInputs,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown,
>(
  config: ExpressHandlerConfig<
    TInputs,
    TSafeInputs,
    TAmbient,
    TPreAuthOut,
    TLoadResourcesOut,
    TFinalAuthOut,
    TUnsafeResponse,
    TResponse
  >
): InferredHandlerConfig => config as unknown as InferredHandlerConfig;

// Adapter-baseline extractInputs: produces the canonical {params, query, body, headers} shape.
function expressBaselineExtractInputs(raw: ExpressRaw): ExpressRawInputs {
  return {
    params: raw.req.params,
    query: raw.req.query,
    body: raw.req.body,
    headers: raw.req.headers,
  };
}

export function toExpressHandler<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    ReservedKeysUnshadowed<TConf> &
    HasResponseMeta,
>(handlingStrategy: TConf, options: HipExpressHandlerOptions = {}) {
  assertHipthrustable(handlingStrategy);

  // Compose: baseline runs first, handler's extractInputs (if any) chains after.
  const handlerExtract = (handlingStrategy as any).extractInputs;
  const composedExtractInputs = handlerExtract
    ? (raw: ExpressRaw) => {
        const canonical = expressBaselineExtractInputs(raw);
        const additions = handlerExtract(canonical) || {};
        return { ...canonical, ...additions };
      }
    : expressBaselineExtractInputs;

  const strategyWithBaseline = {
    ...handlingStrategy,
    extractInputs: composedExtractInputs,
  };

  const fullHipthrustable = withDefaultImplementations(
    strategyWithBaseline as any
  );

  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (req: Request, res: Response, next: NextFunction) => {
    const raw: ExpressRaw = { req, res };
    let lifecycle: LifecycleResult | undefined;
    let info: FinallyInfo;
    // Registered before anything is written; the status is read when the
    // response actually finishes (it may be written by your own error
    // middleware under delegateErrors).
    const schedule = (run: (() => Promise<void>) | undefined) => {
      if (!run) {
        return;
      }
      if (options.scheduleAfterResponse) {
        options.scheduleAfterResponse(run);
        return;
      }
      // 'close' also fires for an aborted response, where 'finish' never
      // does; the guard keeps it to one run.
      let started = false;
      const once = () => {
        if (!started) {
          started = true;
          void run();
        }
      };
      res.on('finish', once);
      res.on('close', once);
    };
    const finallyInfo = (): FinallyInfo =>
      info.status !== undefined
        ? info
        : { ...info, status: res.headersSent ? res.statusCode : undefined };
    try {
      lifecycle = await executeHipthrustable(
        fullHipthrustable as any,
        raw,
        httpLifecycleOptions(req.method, req.headers)
      );
      const meta: ResponseMeta =
        typeof responseMeta === 'function'
          ? responseMeta(lifecycle.context)
          : responseMeta || {};
      const headers = responseHeaders(meta.headers, lifecycle.etag);
      for (const headerName of Object.keys(headers)) {
        res.setHeader(headerName, headers[headerName]);
      }
      info = lifecycle.notModified
        ? { raw, outcome: 'not-modified', status: 304 }
        : { raw, outcome: 'success', status: meta.status || 200 };
      schedule(
        makeAfterResponseRunner(options, {
          raw,
          lifecycle,
          info: finallyInfo,
        })
      );
      if (lifecycle.notModified) {
        res.status(304).end();
      } else {
        res.status(meta.status || 200).json(lifecycle.response);
      }
    } catch (exception) {
      if (!(exception instanceof HipRedirect)) {
        safeInvokeOnError(options.onError, exception, { raw });
      }
      info =
        exception instanceof HipRedirect
          ? { raw, outcome: 'redirect', status: exception.redirectCode }
          : options.delegateErrors
            ? { raw, outcome: 'error', error: exception }
            : {
                raw,
                outcome: 'error',
                status: isHipError(exception)
                  ? hipErrorToStatus(exception)
                  : 500,
                error: exception,
              };
      // Only finally runs for a failed request; deferred tasks are dropped.
      schedule(makeAfterResponseRunner(options, { raw, info: finallyInfo }));
      if (exception instanceof HipRedirect) {
        res.redirect(exception.redirectCode, exception.redirectUrl);
      } else if (options.delegateErrors) {
        next(exception);
      } else if (isHipError(exception)) {
        res.status(hipErrorToStatus(exception)).json(hipErrorToBody(exception));
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}

// Adapter preset factory: bakes shared options into a reusable handler
// converter (mirrors makeNextHandlerFactory); per-call options merge OVER
// the defaults.
export function makeExpressHandlerFactory(defaults: HipExpressHandlerOptions) {
  return function toExpressHandlerWithDefaults<
    TConf extends OptionalStagesShape &
      HasRequiredStages &
      PreAuthorizeDepsMet<TConf> &
      LoadResourcesDepsMet<TConf> &
      FinalAuthorizeDepsMet<TConf> &
      ExecuteDepsMet<TConf> &
      RedactResponseDepsMet<TConf> &
      ReservedKeysUnshadowed<TConf> &
      HasResponseMeta,
  >(handlingStrategy: TConf, options: HipExpressHandlerOptions = {}) {
    return toExpressHandler(handlingStrategy, { ...defaults, ...options });
  };
}
