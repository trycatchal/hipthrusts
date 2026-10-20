import { Context } from 'hono';
import { executeHipthrustable, LifecycleResult } from './core.js';
import {
  hipErrorToBody,
  hipErrorToStatus,
  HipRedirect,
  isHipError,
} from './errors.js';
import { HipBadInputs } from './errors.js';
import {
  composeHttpHipthrustable,
  FinallyInfo,
  HasResponseMeta,
  httpLifecycleOptions,
  HttpAdapterOptions,
  HttpHandlerConfig,
  HttpRawInputs,
  makeAfterResponseRunner,
  resolveResponseMeta,
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
  RedactResponseDepsMet,
  ReservedKeysUnshadowed,
} from './types.js';

// The raw envelope a hono handler receives: the hono Context plus the values
// pre-extracted from the request (hono body parsing is async, so it happens in
// the adapter before the synchronous lifecycle runs).
export interface HonoRaw extends HttpRawInputs {
  c: Context;
}

export interface HipHonoHandlerOptions extends HttpAdapterOptions {
  // A non-empty request body that fails to parse as JSON responds 422 by
  // default (previously it silently became `{}`). Set true to restore the old
  // coerce-to-{} behavior.
  allowMalformedBody?: boolean;
}

const BODYLESS_METHODS = ['GET', 'HEAD', 'DELETE'];

function honoBaselineExtractInputs(raw: HonoRaw): HttpRawInputs {
  return {
    params: raw.params,
    query: raw.query,
    body: raw.body,
    headers: raw.headers,
  };
}

type InferredHandlerConfig = OptionalStagesShape &
  HasRequiredStages &
  HasResponseMeta;

// Identity function for inference-friendly hono config authoring. Mirrors
// defineExpressHandler; pass the result to toHonoHandler.
export const defineHonoHandler = <
  TInputs = HttpRawInputs,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown,
>(
  config: HttpHandlerConfig<
    HonoRaw,
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

export function toHonoHandler<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    ReservedKeysUnshadowed<TConf> &
    HasResponseMeta,
>(handlingStrategy: TConf, options: HipHonoHandlerOptions = {}) {
  const fullHipthrustable = composeHttpHipthrustable<HonoRaw>(
    handlingStrategy,
    honoBaselineExtractInputs
  );
  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (c: Context) => {
    let raw: HonoRaw | undefined;
    let lifecycle: LifecycleResult | undefined;
    let info: FinallyInfo;
    let response: Response;
    try {
      let body: any = {};
      if (!BODYLESS_METHODS.includes(c.req.method)) {
        const text = await c.req.text();
        if (text.trim() !== '') {
          try {
            body = JSON.parse(text);
          } catch {
            if (options.allowMalformedBody) {
              body = {};
            } else {
              throw new HipBadInputs('Malformed JSON body');
            }
          }
        }
      }
      raw = {
        c,
        params: c.req.param(),
        query: c.req.query(),
        body,
        headers: c.req.header(),
      };
      lifecycle = await executeHipthrustable(
        fullHipthrustable as any,
        raw,
        httpLifecycleOptions(c.req.method, raw.headers)
      );
      const meta = resolveResponseMeta(responseMeta, lifecycle.context);
      const headers = responseHeaders(meta.headers, lifecycle.etag);
      for (const headerName of Object.keys(headers)) {
        c.header(headerName, headers[headerName]);
      }
      if (lifecycle.notModified) {
        response = c.body(null, 304);
        info = { raw, outcome: 'not-modified', status: 304 };
      } else {
        const status = meta.status || 200;
        response = c.json(lifecycle.response, status as any);
        info = { raw, outcome: 'success', status };
      }
    } catch (exception) {
      lifecycle = undefined;
      if (!(exception instanceof HipRedirect)) {
        safeInvokeOnError(options.onError, exception, { raw });
      }
      if (exception instanceof HipRedirect) {
        response = c.redirect(
          exception.redirectUrl,
          exception.redirectCode as any
        );
        info = { raw, outcome: 'redirect', status: response.status };
      } else if (isHipError(exception)) {
        const status = hipErrorToStatus(exception);
        response = c.json(hipErrorToBody(exception) as any, status as any);
        info = { raw, outcome: 'error', status, error: exception };
      } else {
        response = c.json({ error: 'Internal server error' }, 500);
        info = { raw, outcome: 'error', status: 500, error: exception };
      }
    }
    const run = makeAfterResponseRunner(options, {
      raw,
      lifecycle,
      info: () => info,
    });
    if (run) {
      if (options.scheduleAfterResponse) {
        options.scheduleAfterResponse(run);
      } else {
        try {
          // On edge runtimes waitUntil keeps the worker alive for the
          // post-response work; on Node hono has no executionCtx, so fall
          // back to a task.
          c.executionCtx.waitUntil(Promise.resolve().then(run));
        } catch {
          setTimeout(run, 0);
        }
      }
    }
    return response;
  };
}

// Adapter preset factory: bakes shared options into a reusable handler
// converter (mirrors makeNextHandlerFactory); per-call options merge OVER
// the defaults.
export function makeHonoHandlerFactory(defaults: HipHonoHandlerOptions) {
  return function toHonoHandlerWithDefaults<
    TConf extends OptionalStagesShape &
      HasRequiredStages &
      PreAuthorizeDepsMet<TConf> &
      LoadResourcesDepsMet<TConf> &
      FinalAuthorizeDepsMet<TConf> &
      ExecuteDepsMet<TConf> &
      RedactResponseDepsMet<TConf> &
      ReservedKeysUnshadowed<TConf> &
      HasResponseMeta,
  >(handlingStrategy: TConf, options: HipHonoHandlerOptions = {}) {
    return toHonoHandler(handlingStrategy, { ...defaults, ...options });
  };
}
