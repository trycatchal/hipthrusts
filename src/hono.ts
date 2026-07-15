import { Context } from 'hono';
import { executeHipthrustable } from './core.js';
import {
  hipErrorToBody,
  hipErrorToStatus,
  HipRedirect,
  isHipError,
} from './errors.js';
import {
  composeHttpHipthrustable,
  HasResponseMeta,
  HttpHandlerConfig,
  HttpRawInputs,
  resolveResponseMeta,
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
>(handlingStrategy: TConf) {
  const fullHipthrustable = composeHttpHipthrustable<HonoRaw>(
    handlingStrategy,
    honoBaselineExtractInputs
  );
  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (c: Context) => {
    try {
      let body: any = {};
      if (!BODYLESS_METHODS.includes(c.req.method)) {
        try {
          body = await c.req.json();
        } catch {
          body = {};
        }
      }
      const raw: HonoRaw = {
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
      const meta = resolveResponseMeta(responseMeta, context);
      if (meta.headers) {
        for (const headerName of Object.keys(meta.headers)) {
          c.header(headerName, meta.headers[headerName]);
        }
      }
      return c.json(response, (meta.status || 200) as any);
    } catch (exception) {
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
