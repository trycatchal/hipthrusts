import { NextRequest, NextResponse } from 'next/server.js';
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

export interface HipNextHandlerOptions extends HttpAdapterOptions {
  // Async setup run before the lifecycle; its result is merged into the raw
  // envelope so the handler's extractAmbient can read it (e.g. auth principal).
  gatherContext?: (req: NextRequest) => Promise<Record<string, unknown>>;
  // A non-empty request body that fails to parse as JSON responds 422 by
  // default (previously it silently became `{}`, which lets garbage bodies
  // "succeed" against fully-optional schemas). Set true to restore the old
  // coerce-to-{} behavior.
  allowMalformedBody?: boolean;
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
    let raw: NextRaw | undefined;
    try {
      let body: any = {};
      if (!BODYLESS_METHODS.includes(req.method)) {
        const text = await req.text();
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

      const params = routeContext ? await routeContext.params : {};
      const query = Object.fromEntries(req.nextUrl.searchParams.entries());
      const headers = Object.fromEntries(req.headers.entries());
      const extra = options.gatherContext
        ? await options.gatherContext(req)
        : {};

      raw = {
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
      if (options.afterResponse) {
        // Scheduled AFTER the lifecycle resolves so the callback receives the
        // final context, via Next's `after()` (runs once the response is
        // sent). Failed requests never fire it.
        const runAfterResponse = () =>
          safeInvokeAfterResponse(
            options.afterResponse,
            context,
            options.onError,
            raw
          );
        try {
          const { after } = await import('next/server.js');
          after(runAfterResponse);
        } catch {
          // `after` unavailable (older Next.js); run fire-and-forget instead.
          runAfterResponse();
        }
      }
      const meta = resolveResponseMeta(responseMeta, context);
      return NextResponse.json(response, {
        status: meta.status || 200,
        headers: meta.headers,
      });
    } catch (exception) {
      if (!(exception instanceof HipRedirect)) {
        safeInvokeOnError(options.onError, exception, { raw });
      }
      if (exception instanceof HipRedirect) {
        const code = REDIRECT_CODES.includes(exception.redirectCode)
          ? exception.redirectCode
          : 302;
        return NextResponse.redirect(
          exception.redirectUrl,
          code as 301 | 302 | 303 | 307 | 308
        );
      } else if (isHipError(exception)) {
        return NextResponse.json(hipErrorToBody(exception), {
          status: hipErrorToStatus(exception),
        });
      }
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

// Adapter preset factory: bakes shared options (gatherContext, onError,
// afterResponse, ...) into a reusable handler converter so routes don't
// repeat them on every toNextHandler call:
//   export const toAppHandler = makeNextHandlerFactory({ gatherContext });
// Per-call options merge OVER the defaults.
export function makeNextHandlerFactory(defaults: HipNextHandlerOptions) {
  return function toNextHandlerWithDefaults<
    TConf extends OptionalStagesShape &
      HasRequiredStages &
      PreAuthorizeDepsMet<TConf> &
      LoadResourcesDepsMet<TConf> &
      FinalAuthorizeDepsMet<TConf> &
      ExecuteDepsMet<TConf> &
      RedactResponseDepsMet<TConf> &
      HasResponseMeta,
  >(handlingStrategy: TConf, options: HipNextHandlerOptions = {}) {
    return toNextHandler(handlingStrategy, { ...defaults, ...options });
  };
}
