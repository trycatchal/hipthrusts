import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  executeHipthrustable,
  HipError,
  HipRedirectException,
} from './core';
import {
  prepareHipthrustable,
  HasAllNotRequireds,
  HasAllRequireds,
  PreAuthReqsSatisfied,
  AttachDataReqsSatisfiedOptional,
  FinalAuthReqsSatisfied,
  DoWorkReqsSatisfiedOptional,
  RespondReqsSatisfied,
  SanitizeResponseReqsSatisfied,
} from './adapter';

export function hipFastifyHandlerFactory<
  TConf extends HasAllNotRequireds &
    HasAllRequireds &
    PreAuthReqsSatisfied<TConf> &
    AttachDataReqsSatisfiedOptional<TConf> &
    FinalAuthReqsSatisfied<TConf> &
    DoWorkReqsSatisfiedOptional<TConf> &
    RespondReqsSatisfied<TConf> &
    SanitizeResponseReqsSatisfied<TConf>
>(handlingStrategy: TConf) {
  const fullHipthrustable = prepareHipthrustable(handlingStrategy);

  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { response, status } = await executeHipthrustable(
        fullHipthrustable,
        { req, reply },
        req.params as Record<string, string>,
        req.query as Record<string, string>,
        req.body as Record<string, unknown> || {}
      );

      return reply.status(status).send(response);
    } catch (exception) {
      if (exception instanceof HipRedirectException) {
        return reply.redirect(exception.redirectUrl);
      }

      if (HipError.isHipError(exception)) {
        return reply
          .status(exception.statusCode)
          .send({ error: exception.message });
      }

      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}
