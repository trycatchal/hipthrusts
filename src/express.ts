import { NextFunction, Request, Response } from 'express';
import {
  assertHipthrustable,
  executeHipthrustable,
  HasSuccessStatus,
  HipRedirectException,
  SuccessStatus,
  withDefaultImplementations,
} from './core';
import {
  LoadResourcesDepsMet,
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  OptionalStagesShape,
  HasRequiredStages,
  PreAuthorizeDepsMet,
  PromiseOrSync,
  PromiseResolveOrSync,
  RedactResponseDepsMet,
} from './types';

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

// Handler config the dev writes for an express endpoint.
// `extractInputs` chains AFTER the adapter baseline; if omitted, the canonical
// {params, query, body, headers} shape flows directly to sanitizeInputs.
// tslint:disable-next-line:interface-over-type-literal
type ExpressHandlerConfig<
  TInputs = ExpressRawInputs,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown
> = {
  extractAmbient?: (raw: ExpressRaw) => TAmbient;
  extractInputs?: (canonical: ExpressRawInputs) => TInputs;
  sanitizeInputs: (unsafe: TInputs) => TSafeInputs;
  preAuthorize: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient
    ] extends [never]
      ? {}
      : { ambient: TAmbient })
  ) => TPreAuthOut;
  loadResources?: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut>
  ) => PromiseOrSync<TLoadResourcesOut>;
  finalAuthorize: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut>
  ) => PromiseOrSync<TFinalAuthOut>;
  execute: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<TUnsafeResponse>;
  redactResponse: (
    unsafe: PromiseResolveOrSync<TUnsafeResponse>
  ) => TResponse;
  successStatus?: SuccessStatus;
};

type InferredHandlerConfig = OptionalStagesShape &
  HasRequiredStages &
  HasSuccessStatus;

// Identity function for inference-friendly config authoring.
export const defineExpressHandler = <
  TInputs = ExpressRawInputs,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown
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
): InferredHandlerConfig => (config as unknown) as InferredHandlerConfig;

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
    HasSuccessStatus
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

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { response, status } = await executeHipthrustable(
        fullHipthrustable as any,
        { req, res },
        200
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
