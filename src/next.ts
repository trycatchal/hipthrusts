import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
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

// ── Next.js-specific types ─────────────────────────────────────────────

/** Next.js App Router passes dynamic route params (e.g. [id]) as a Promise. */
export type NextRouteContext = {
  params: Promise<Record<string, string | string[]>>;
};

/** The "unsafe" object passed to initPreContext in a Next.js handler. */
export type NextUnsafe<TExtra = {}> = { req: NextRequest } & TExtra;

// ── Options ────────────────────────────────────────────────────────────

export interface HipNextHandlerOptions {
  /**
   * Async setup that runs BEFORE the HipThrusTS lifecycle.
   * Results are merged into the `unsafe` object that initPreContext receives.
   */
  gatherContext?: (req: NextRequest) => Promise<Record<string, unknown>>;
  /** Scheduled via Next.js after() for post-response cleanup (e.g. log flushing). */
  afterResponse?: () => void;
}

// ── Factory ────────────────────────────────────────────────────────────

export function hipNextHandlerFactory<
  TConf extends HasAllNotRequireds &
    HasAllRequireds &
    PreAuthReqsSatisfied<TConf> &
    AttachDataReqsSatisfiedOptional<TConf> &
    FinalAuthReqsSatisfied<TConf> &
    DoWorkReqsSatisfiedOptional<TConf> &
    RespondReqsSatisfied<TConf> &
    SanitizeResponseReqsSatisfied<TConf>
>(handlingStrategy: TConf, options?: HipNextHandlerOptions) {
  const fullHipthrustable = prepareHipthrustable(handlingStrategy);

  return async (
    req: NextRequest,
    routeContext: NextRouteContext
  ): Promise<NextResponse> => {
    try {
      if (options?.afterResponse) {
        const { after } = await import('next/server');
        after(options.afterResponse);
      }

      const extraContext = options?.gatherContext
        ? await options.gatherContext(req)
        : {};

      const unsafe = { req, ...extraContext };

      const params = routeContext?.params
        ? await routeContext.params
        : {};
      const queryParams = Object.fromEntries(req.nextUrl.searchParams);

      let body = {};
      const method = req.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
        try {
          body = await req.json();
        } catch {
          // No body or non-JSON body — sanitizeBody will validate if needed
        }
      }

      const { response, status } = await executeHipthrustable(
        fullHipthrustable,
        unsafe,
        params,
        queryParams,
        body
      );

      return NextResponse.json(response, { status });
    } catch (exception) {
      if (exception instanceof HipRedirectException) {
        return NextResponse.redirect(
          exception.redirectUrl,
          exception.redirectCode as 301 | 302 | 303 | 307 | 308
        );
      }

      if (HipError.isHipError(exception)) {
        return NextResponse.json(
          { error: exception.message },
          { status: exception.statusCode }
        );
      }

      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}
