// Shared base for HTTP-style adapters (Hono, Fastify, Next.js). These adapters
// all share the canonical { params, query, body, headers } input shape and
// respond with a raw HTTP status + JSON body. This module has NO framework
// imports so importing one adapter never drags in another framework's runtime.
import { assertHipthrustable, withDefaultImplementations } from './core.js';
import { PromiseOrSync, PromiseResolveOrSync } from './types.js';

// Canonical input shape produced by every HTTP adapter baseline.
export interface HttpRawInputs {
  params: any;
  query: any;
  body: any;
  headers: any;
}

// HTTP response metadata a handler may emit (mirrors the express adapter).
export interface ResponseMeta {
  status?: number;
  headers?: Record<string, string>;
}

export interface HasResponseMeta<TCtx = any> {
  responseMeta?: ResponseMeta | ((ctx: TCtx) => ResponseMeta);
}

// Options shared by every HTTP adapter.
export interface HttpAdapterOptions {
  // Observability seam: called with every error the adapter converts to an
  // error response (HipErrors and unknown failures alike; redirects excluded).
  // With unknown-error cause-chaining, `error.cause` holds the real underlying
  // failure. A throwing onError never affects the response.
  onError?: (error: unknown, info: { raw?: unknown }) => void;
  // Post-response side effects (audit logs, notifications) with access to the
  // full final lifecycle context (inputs, ambient, loaded resources, response).
  // Runs only after a SUCCESSFUL lifecycle; failures never fire it. Errors
  // thrown from it never affect the response.
  afterResponse?: (context: Record<string, unknown>) => void | Promise<void>;
}

// Invokes onError so that a broken logging hook can never break the response.
export function safeInvokeOnError(
  onError: HttpAdapterOptions['onError'],
  error: unknown,
  info: { raw?: unknown }
) {
  if (!onError) {
    return;
  }
  try {
    onError(error, info);
  } catch {
    // Logging failures are intentionally swallowed.
  }
}

// Fire-and-forget afterResponse; sync throws and async rejections are both
// swallowed so side effects can never affect the (already sent) response.
export function safeInvokeAfterResponse(
  afterResponse: HttpAdapterOptions['afterResponse'],
  context: Record<string, unknown>
) {
  if (!afterResponse) {
    return;
  }
  try {
    Promise.resolve(afterResponse(context)).catch(() => {});
  } catch {
    // Side-effect failures are intentionally swallowed.
  }
}

// Generic HTTP handler config, parameterized by the framework raw type so each
// adapter supplies its own shape for extractAmbient/extractInputs. Everything
// from sanitizeInputs onward is framework-independent.
export type HttpHandlerConfig<
  TRaw,
  TInputs = HttpRawInputs,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown,
> = {
  extractAmbient?: (raw: TRaw) => TAmbient;
  extractInputs?: (canonical: HttpRawInputs) => TInputs;
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
  redactResponse: (
    unsafe: PromiseResolveOrSync<TUnsafeResponse>,
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & ([
      TAmbient,
    ] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => TResponse;
  responseMeta?: ResponseMeta | ((ctx: any) => ResponseMeta);
};

// Validates the handler, composes the framework baseline extractInputs with the
// handler's optional extractInputs, then fills optional stages with defaults.
// Call once per handler (at factory/import time), not per request.
export function composeHttpHipthrustable<TRaw>(
  handlingStrategy: any,
  baselineExtractInputs: (raw: TRaw) => HttpRawInputs
) {
  assertHipthrustable(handlingStrategy);

  const handlerExtract = handlingStrategy.extractInputs;
  const composedExtractInputs = handlerExtract
    ? (raw: TRaw) => {
        const canonical = baselineExtractInputs(raw);
        const additions = handlerExtract(canonical) || {};
        return { ...canonical, ...additions };
      }
    : baselineExtractInputs;

  return withDefaultImplementations({
    ...handlingStrategy,
    extractInputs: composedExtractInputs,
  } as any);
}

// Resolves a possibly-functional responseMeta against the final lifecycle context.
export function resolveResponseMeta(
  responseMeta: ResponseMeta | ((ctx: any) => ResponseMeta) | undefined,
  context: any
): ResponseMeta {
  return typeof responseMeta === 'function'
    ? responseMeta(context)
    : responseMeta || {};
}
