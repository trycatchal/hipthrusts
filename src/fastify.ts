import { FastifyReply, FastifyRequest } from 'fastify';
import { executeHipthrustable } from './core';
import { hipErrorToStatus, HipRedirect, isHipError } from './errors';
import {
  composeHttpHipthrustable,
  HasResponseMeta,
  HttpHandlerConfig,
  HttpRawInputs,
  resolveResponseMeta,
} from './http-adapter';
import {
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  HasRequiredStages,
  LoadResourcesDepsMet,
  OptionalStagesShape,
  PreAuthorizeDepsMet,
  RedactResponseDepsMet,
} from './types';

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
  TResponse = unknown
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
): InferredHandlerConfig => (config as unknown) as InferredHandlerConfig;

export function toFastifyHandler<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    HasResponseMeta
>(handlingStrategy: TConf) {
  const fullHipthrustable = composeHttpHipthrustable<FastifyRaw>(
    handlingStrategy,
    fastifyBaselineExtractInputs
  );
  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { response, context } = await executeHipthrustable(
        fullHipthrustable as any,
        { req, reply }
      );
      const meta = resolveResponseMeta(responseMeta, context);
      if (meta.headers) {
        for (const headerName of Object.keys(meta.headers)) {
          reply.header(headerName, meta.headers[headerName]);
        }
      }
      return reply.status(meta.status || 200).send(response);
    } catch (exception) {
      if (exception instanceof HipRedirect) {
        return reply.redirect(exception.redirectUrl, exception.redirectCode);
      } else if (isHipError(exception)) {
        return reply
          .status(hipErrorToStatus(exception))
          .send({ error: exception.message });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}
