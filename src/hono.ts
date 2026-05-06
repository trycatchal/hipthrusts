import type { Context } from 'hono';
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

export function hipHonoHandlerFactory<
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

  return async (c: Context) => {
    try {
      const params = c.req.param();
      const queryParams = c.req.query();

      let body = {};
      const method = c.req.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
        try {
          body = await c.req.json();
        } catch {
          // No body or non-JSON body
        }
      }

      const { response, status } = await executeHipthrustable(
        fullHipthrustable,
        { c },
        params,
        queryParams,
        body
      );

      return c.json(response, status as any);
    } catch (exception) {
      if (exception instanceof HipRedirectException) {
        return c.redirect(exception.redirectUrl, exception.redirectCode as any);
      }

      if (HipError.isHipError(exception)) {
        return c.json(
          { error: exception.message },
          exception.statusCode as any
        );
      }

      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}
