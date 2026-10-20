import { FastifyReply, FastifyRequest } from 'fastify';
import { executeHipthrustable } from './core.js';
import {
  hipErrorToBody,
  hipErrorToStatus,
  HipRedirect,
  isHipError,
} from './errors.js';
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

// The raw envelope a fastify handler receives. Fastify parses params/query/body
// for us, so the baseline reads them straight off the request.
export interface FastifyRaw {
  req: FastifyRequest;
  reply: FastifyReply;
}

function fastifyBaselineExtractInputs(raw: FastifyRaw): HttpRawInputs {
  return {
    params: raw.req.params,
    query: raw.req.query,
    body: raw.req.body || {},
    headers: raw.req.headers,
  };
}

type InferredHandlerConfig = OptionalStagesShape &
  HasRequiredStages &
  HasResponseMeta;

// Identity function for inference-friendly fastify config authoring. Mirrors
// defineExpressHandler; pass the result to toFastifyHandler.
export const defineFastifyHandler = <
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
    FastifyRaw,
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

export function toFastifyHandler<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    ReservedKeysUnshadowed<TConf> &
    HasResponseMeta,
>(handlingStrategy: TConf, options: HttpAdapterOptions = {}) {
  const fullHipthrustable = composeHttpHipthrustable<FastifyRaw>(
    handlingStrategy,
    fastifyBaselineExtractInputs
  );
  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw: FastifyRaw = { req, reply };
    let info: FinallyInfo;
    // Fastify's per-request "onResponse": the raw response's finish (or
    // close, for an aborted response) — once.
    const schedule = (run: (() => Promise<void>) | undefined) => {
      if (!run) {
        return;
      }
      if (options.scheduleAfterResponse) {
        options.scheduleAfterResponse(run);
        return;
      }
      const rawResponse = reply.raw as FastifyReply['raw'] | undefined;
      if (!rawResponse || typeof rawResponse.on !== 'function') {
        // No Node response to observe (a stubbed reply): off the
        // response path is the best available approximation.
        setImmediate(run);
        return;
      }
      let started = false;
      const once = () => {
        if (!started) {
          started = true;
          void run();
        }
      };
      rawResponse.on('finish', once);
      rawResponse.on('close', once);
    };
    try {
      const lifecycle = await executeHipthrustable(
        fullHipthrustable as any,
        raw,
        httpLifecycleOptions(req.method, req.headers)
      );
      const meta = resolveResponseMeta(responseMeta, lifecycle.context);
      const headers = responseHeaders(meta.headers, lifecycle.etag);
      for (const headerName of Object.keys(headers)) {
        reply.header(headerName, headers[headerName]);
      }
      const status = lifecycle.notModified ? 304 : meta.status || 200;
      info = {
        raw,
        outcome: lifecycle.notModified ? 'not-modified' : 'success',
        status,
      };
      schedule(
        makeAfterResponseRunner(options, {
          raw,
          lifecycle,
          info: () => info,
        })
      );
      if (lifecycle.notModified) {
        return reply.status(304).send();
      }
      return reply.status(status).send(lifecycle.response);
    } catch (exception) {
      if (!(exception instanceof HipRedirect)) {
        safeInvokeOnError(options.onError, exception, { raw });
      }
      if (exception instanceof HipRedirect) {
        info = { raw, outcome: 'redirect', status: exception.redirectCode };
        schedule(makeAfterResponseRunner(options, { raw, info: () => info }));
        return reply.redirect(exception.redirectUrl, exception.redirectCode);
      }
      const status = isHipError(exception) ? hipErrorToStatus(exception) : 500;
      info = { raw, outcome: 'error', status, error: exception };
      schedule(makeAfterResponseRunner(options, { raw, info: () => info }));
      if (isHipError(exception)) {
        return reply.status(status).send(hipErrorToBody(exception));
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}

// Adapter preset factory: bakes shared options into a reusable handler
// converter (mirrors makeNextHandlerFactory); per-call options merge OVER
// the defaults.
export function makeFastifyHandlerFactory(defaults: HttpAdapterOptions) {
  return function toFastifyHandlerWithDefaults<
    TConf extends OptionalStagesShape &
      HasRequiredStages &
      PreAuthorizeDepsMet<TConf> &
      LoadResourcesDepsMet<TConf> &
      FinalAuthorizeDepsMet<TConf> &
      ExecuteDepsMet<TConf> &
      RedactResponseDepsMet<TConf> &
      ReservedKeysUnshadowed<TConf> &
      HasResponseMeta,
  >(handlingStrategy: TConf, options: HttpAdapterOptions = {}) {
    return toFastifyHandler(handlingStrategy, { ...defaults, ...options });
  };
}
