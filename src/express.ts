import Boom from '@hapi/boom';
import { NextFunction, Request, Response } from 'express';
import {
  assertHipthrustable,
  executeHipthrustable,
  withDefaultImplementations,
} from './core.js';
import { HipError, HipRedirect, isHipError } from './errors.js';
import { HasResponseMeta, ResponseMeta } from './http-adapter.js';
import {
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  HasRequiredStages,
  LoadResourcesDepsMet,
  OptionalStagesShape,
  PreAuthorizeDepsMet,
  PromiseOrSync,
  PromiseResolveOrSync,
  RedactResponseDepsMet,
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

// Maps a transport-agnostic HipError to its Boom equivalent so existing express
// error-handling middleware keeps working unchanged.
function hipErrorToBoom(error: HipError): Error {
  switch (error.kind) {
    case 'badInputs':
      return Boom.badData(error.message, error.detail);
    case 'unauthorized':
      return Boom.unauthorized(error.message);
    case 'forbidden':
      return Boom.forbidden(error.message);
    case 'notFound':
      return Boom.notFound(error.message);
    case 'conflict':
      return Boom.conflict(error.message);
    default:
      return Boom.badImplementation(error.message);
  }
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
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient,
    ] extends [never]
      ? {}
      : { ambient: TAmbient })
  ) => TPreAuthOut;
  loadResources?: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient,
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut>
  ) => PromiseOrSync<TLoadResourcesOut>;
  finalAuthorize: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient,
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut>
  ) => PromiseOrSync<TFinalAuthOut>;
  execute: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient,
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<TUnsafeResponse>;
  redactResponse: (unsafe: PromiseResolveOrSync<TUnsafeResponse>) => TResponse;
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
    HasResponseMeta,
>(handlingStrategy: TConf) {
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
    try {
      const { response, context } = await executeHipthrustable(
        fullHipthrustable as any,
        { req, res }
      );
      const meta: ResponseMeta =
        typeof responseMeta === 'function'
          ? responseMeta(context)
          : responseMeta || {};
      if (meta.headers) {
        for (const headerName of Object.keys(meta.headers)) {
          res.setHeader(headerName, meta.headers[headerName]);
        }
      }
      res.status(meta.status || 200).json(response);
    } catch (exception) {
      if (exception instanceof HipRedirect) {
        res.redirect(exception.redirectCode, exception.redirectUrl);
      } else if (isHipError(exception)) {
        next(hipErrorToBoom(exception));
      } else {
        next(exception);
      }
    }
  };
}
