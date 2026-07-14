import { NextRequest, NextResponse } from 'next/server.js';
import { executeHipthrustable } from './core.js';
import { hipErrorToStatus, HipRedirect, isHipError } from './errors.js';
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

// App Router route context: params arrive as a Promise.
export interface NextRouteContext {
  params: Promise<Record<string, string | string[]>>;
}

// The raw envelope a Next.js handler receives: the request plus values
// pre-extracted in the adapter (params are awaited, body parsed) and any extra
// context produced by `gatherContext`.
export interface NextRaw extends HttpRawInputs {
  req: NextRequest;
  [key: string]: unknown;
}

export interface HipNextHandlerOptions {
  // Async setup run before the lifecycle; its result is merged into the raw
  // envelope so the handler's extractAmbient can read it (e.g. auth principal).
  gatherContext?: (req: NextRequest) => Promise<Record<string, unknown>>;
  // Scheduled via Next's `after()` to run once the response is sent.
  afterResponse?: () => void;
}

const BODYLESS_METHODS = ['GET', 'HEAD', 'DELETE'];
const REDIRECT_CODES = [301, 302, 303, 307, 308];

function nextBaselineExtractInputs(raw: NextRaw): HttpRawInputs {
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

// Identity function for inference-friendly Next.js config authoring. Mirrors
// defineExpressHandler; pass the result to toNextHandler.
export const defineNextHandler = <
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
    NextRaw,
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

export function toNextHandler<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    HasResponseMeta,
>(handlingStrategy: TConf, options: HipNextHandlerOptions = {}) {
  const fullHipthrustable = composeHttpHipthrustable<NextRaw>(
    handlingStrategy,
    nextBaselineExtractInputs
  );
  const responseMeta = (handlingStrategy as HasResponseMeta).responseMeta;

  return async (
    req: NextRequest,
    routeContext?: NextRouteContext
  ): Promise<NextResponse> => {
    try {
      if (options.afterResponse) {
        try {
          const { after } = await import('next/server.js');
          after(options.afterResponse);
        } catch {
          // `after` unavailable (older Next.js); skip scheduling.
        }
      }

      let body: any = {};
      if (!BODYLESS_METHODS.includes(req.method)) {
        try {
          body = await req.json();
        } catch {
          body = {};
        }
      }

      const params = routeContext ? await routeContext.params : {};
      const query = Object.fromEntries(req.nextUrl.searchParams.entries());
      const headers = Object.fromEntries(req.headers.entries());
      const extra = options.gatherContext
        ? await options.gatherContext(req)
        : {};

      const raw: NextRaw = {
        req,
        params,
        query,
        body,
        headers,
        ...extra,
      };

      const { response, context } = await executeHipthrustable(
        fullHipthrustable as any,
        raw
      );
      const meta = resolveResponseMeta(responseMeta, context);
      return NextResponse.json(response, {
        status: meta.status || 200,
        headers: meta.headers,
      });
    } catch (exception) {
      if (exception instanceof HipRedirect) {
        const code = REDIRECT_CODES.includes(exception.redirectCode)
          ? exception.redirectCode
          : 302;
        return NextResponse.redirect(
          exception.redirectUrl,
          code as 301 | 302 | 303 | 307 | 308
        );
      } else if (isHipError(exception)) {
        return NextResponse.json(
          { error: exception.message },
          { status: hipErrorToStatus(exception) }
        );
      }
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}
