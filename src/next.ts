import { NextRequest, NextResponse } from 'next/server.js';
import { executeHipthrustable, LifecycleResult } from './core.js';
import {
  hipErrorToBody,
  hipErrorToStatus,
  HipRedirect,
  isHipError,
} from './errors.js';
import { HipBadInputs } from './errors.js';
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
    ReservedKeysUnshadowed<TConf> &
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
    let lifecycle: LifecycleResult | undefined;
    let info: FinallyInfo;
    let response: NextResponse;
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

      lifecycle = await executeHipthrustable(
        fullHipthrustable as any,
        raw,
        httpLifecycleOptions(req.method, headers)
      );
      const meta = resolveResponseMeta(responseMeta, lifecycle.context);
      const responseHeadersOut = responseHeaders(meta.headers, lifecycle.etag);
      if (lifecycle.notModified) {
        // 304 carries no body (a Response with one is rejected outright).
        response = new NextResponse(null, {
          status: 304,
          headers: responseHeadersOut,
        });
        info = { raw, outcome: 'not-modified', status: 304 };
      } else {
        const status = meta.status || 200;
        response = NextResponse.json(lifecycle.response, {
          status,
          headers: responseHeadersOut,
        });
        info = { raw, outcome: 'success', status };
      }
    } catch (exception) {
      lifecycle = undefined;
      if (!(exception instanceof HipRedirect)) {
        safeInvokeOnError(options.onError, exception, { raw });
      }
      if (exception instanceof HipRedirect) {
        const code = REDIRECT_CODES.includes(exception.redirectCode)
          ? exception.redirectCode
          : 302;
        response = NextResponse.redirect(
          exception.redirectUrl,
          code as 301 | 302 | 303 | 307 | 308
        );
        info = { raw, outcome: 'redirect', status: code };
      } else if (isHipError(exception)) {
        const status = hipErrorToStatus(exception);
        response = NextResponse.json(hipErrorToBody(exception), { status });
        info = { raw, outcome: 'error', status, error: exception };
      } else {
        response = NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
        info = { raw, outcome: 'error', status: 500, error: exception };
      }
    }
    // Scheduled once the response is built, so deferred tasks and
    // afterResponse see the final context and finally knows the outcome.
    const run = makeAfterResponseRunner(options, {
      raw,
      lifecycle,
      info: () => info,
    });
    if (run) {
      await scheduleAfterResponse(options, run);
    }
    return response;
  };
}

// Next's after() runs the callback once the response has been sent (and keeps
// a serverless function alive until it settles). Outside a request scope or
// on a Next.js without after(), fall back to fire-and-forget.
async function scheduleAfterResponse(
  options: HipNextHandlerOptions,
  run: () => Promise<void>
) {
  if (options.scheduleAfterResponse) {
    options.scheduleAfterResponse(run);
    return;
  }
  try {
    const { after } = await import('next/server.js');
    after(run);
  } catch {
    void run();
  }
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
      ReservedKeysUnshadowed<TConf> &
      HasResponseMeta,
  >(handlingStrategy: TConf, options: HipNextHandlerOptions = {}) {
    return toNextHandler(handlingStrategy, { ...defaults, ...options });
  };
}
