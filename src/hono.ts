import { Context } from 'hono';
import { executeHipthrustable } from './core.js';
import {
  hipErrorToBody,
  hipErrorToStatus,
  HipRedirect,
  isHipError,
} from './errors.js';
import { HipBadInputs } from './errors.js';
import {
  composeHttpHipthrustable,
  HasResponseMeta,
  HttpAdapterOptions,
  HttpHandlerConfig,
  HttpRawInputs,
  resolveResponseMeta,
  safeInvokeAfterResponse,
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
    HasResponseMeta,
>(handlingStrategy: TConf, options: HipHonoHandlerOptions = {}) {
  const fullHipthrustable = composeHttpHipthrustable<HonoRaw>(
    handlingStrategy,
    honoBaselineExtractInputs
  );
  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (c: Context) => {
    let raw: HonoRaw | undefined;
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
      const { response, context } = await executeHipthrustable(
        fullHipthrustable as any,
        raw
      );
      if (options.afterResponse) {
        const runAfterResponse = () =>
          safeInvokeAfterResponse(options.afterResponse, context);
        try {
          // On edge runtimes waitUntil keeps the worker alive for the side
          // effect; on Node hono has no executionCtx, so fall back to a task.
          c.executionCtx.waitUntil(Promise.resolve().then(runAfterResponse));
        } catch {
          setTimeout(runAfterResponse, 0);
        }
      }
      const meta = resolveResponseMeta(responseMeta, context);
      if (meta.headers) {
        for (const headerName of Object.keys(meta.headers)) {
          c.header(headerName, meta.headers[headerName]);
        }
      }
      return c.json(response, (meta.status || 200) as any);
    } catch (exception) {
      if (!(exception instanceof HipRedirect)) {
        safeInvokeOnError(options.onError, exception, { raw });
      }
      if (exception instanceof HipRedirect) {
        return c.redirect(exception.redirectUrl, exception.redirectCode as any);
      } else if (isHipError(exception)) {
        return c.json(
          hipErrorToBody(exception) as any,
          hipErrorToStatus(exception) as any
        );
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}
