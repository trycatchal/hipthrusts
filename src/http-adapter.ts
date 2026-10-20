// Shared base for HTTP-style adapters (Hono, Fastify, Next.js). These adapters
// all share the canonical { params, query, body, headers } input shape and
// respond with a raw HTTP status + JSON body. This module has NO framework
// imports so importing one adapter never drags in another framework's runtime.
import {
  assertHipthrustable,
  LifecycleOptions,
  LifecycleResult,
  withDefaultImplementations,
} from './core.js';
import { HipInternal, INTERNAL_ERROR_MESSAGE } from './errors.js';
import {
  ETagResult,
  ETagValue,
  HasDefer,
  PromiseOrSync,
  PromiseResolveOrSync,
} from './types.js';

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

// Info the adapters hand to onError alongside the error itself. `phase` is
// absent for request-lifecycle errors (the ones that become an error
// response). The post-response phases mark errors that could no longer affect
// the already-sent response: 'defer' (a ctx.defer task threw or rejected),
// 'afterResponse' (the afterResponse hook), 'finally' (the finally hook).
export interface OnErrorInfo {
  raw?: unknown;
  phase?: 'defer' | 'afterResponse' | 'finally';
}

// What the `finally` hook learns about the request it closes out.
export interface FinallyInfo {
  raw?: unknown;
  // 'success' (2xx from the handler), 'not-modified' (the etag stage matched
  // → 304), 'redirect' (a HipRedirect), 'error' (any error response,
  // including an unexpected 500, or an error delegated to express's next()).
  outcome: 'success' | 'not-modified' | 'redirect' | 'error';
  // The HTTP status sent. Undefined only where the adapter can't know it
  // (tRPC; express when an error is delegated and no response was finished).
  status?: number;
  // The error behind an 'error' outcome.
  error?: unknown;
}

// Options shared by every HTTP adapter.
export interface HttpAdapterOptions {
  // Observability seam: called with every error the adapter converts to an
  // error response (HipErrors and unknown failures alike; redirects excluded),
  // AND with errors thrown from afterResponse (identified by
  // info.phase === 'afterResponse') — a failed audit write is observable even
  // though it can never affect the already-sent response. With unknown-error
  // cause-chaining, `error.cause` holds the real underlying failure. A
  // throwing onError never affects the response.
  onError?: (error: unknown, info: OnErrorInfo) => void;
  // Post-response side effects (audit logs, notifications) with access to the
  // full final lifecycle context (inputs, ambient, loaded resources, response).
  // Runs only after a SUCCESSFUL lifecycle; failures never fire it. Errors
  // thrown from it never affect the response, but they are routed to onError
  // with phase 'afterResponse'.
  afterResponse?: (context: Record<string, unknown>) => void | Promise<void>;
  // Runs exactly once per request, after the response is sent and after every
  // ctx.defer task and afterResponse have settled — for EVERY outcome:
  // success, 304, redirect, HipError, unexpected 500. The place for "flush
  // the log exporter before the serverless function freezes". Errors thrown
  // from it are routed to onError with phase 'finally'.
  finally?: (info: FinallyInfo) => void | Promise<void>;
  // Overrides how the post-response runner (deferred tasks → afterResponse →
  // finally) is scheduled. Each adapter's default is the framework's own
  // after-the-response mechanism (Next: after(); Hono: waitUntil; Express /
  // Fastify: the response's finish/close event). The runner never rejects.
  // The test seam: collect the runner and await it deterministically.
  //   const runs: Array<() => Promise<void>> = [];
  //   toNextHandler(h, { scheduleAfterResponse: (run) => runs.push(run) });
  //   ...; await Promise.all(runs.map((run) => run()));
  scheduleAfterResponse?: (run: () => Promise<void>) => void;
}

// Formats an `etag` stage result as an entity-tag header value (RFC 9110
// §8.8.3): "value", or W/"value" for a weak tag. The value is opaque but must
// be etagc characters (no DQUOTE, whitespace or controls), so a malformed tag
// can't corrupt or inject headers; a bad tag is a server bug → HipInternal.
export function formatETag(tag: ETagValue): string {
  const { value, weak } =
    typeof tag === 'string' ? { value: tag, weak: false } : tag;
  if (typeof value !== 'string' || !/^[\x21\x23-\x7e\x80-\xff]*$/.test(value)) {
    throw new HipInternal(INTERNAL_ERROR_MESSAGE, {
      reason:
        'etag stage returned an invalid entity-tag value (return the bare value, without quotes or W/)',
    });
  }
  return `${weak ? 'W/' : ''}"${value}"`;
}

// Does an If-None-Match header match the current entity-tag? RFC 9110
// §13.1.2: `*` matches any current representation; otherwise the header is a
// comma-separated list of entity-tags compared with the WEAK comparison
// function (the W/ prefix is ignored on both sides). Quoted values may contain
// commas, so the list is scanned tag by tag rather than split on ','.
// Malformed members never match.
export function ifNoneMatchMatches(
  header: string | readonly string[] | null | undefined,
  etag: string
): boolean {
  if (header === null || header === undefined) {
    return false;
  }
  const raw = typeof header === 'string' ? header : header.join(',');
  const current = opaqueTag(etag);
  if (current === undefined) {
    return false;
  }
  const member = /\s*(?:(\*)|(?:W\/)?"([^"]*)")\s*(?:,|$)/y;
  let index = 0;
  while (index < raw.length) {
    member.lastIndex = index;
    const match = member.exec(raw);
    if (!match) {
      // Skip a malformed member up to the next comma.
      const nextComma = raw.indexOf(',', index);
      if (nextComma === -1) {
        break;
      }
      index = nextComma + 1;
      continue;
    }
    if (match[1] === '*' || match[2] === current) {
      return true;
    }
    index = member.lastIndex;
  }
  return false;
}

function opaqueTag(etag: string): string | undefined {
  const match = /^(?:W\/)?"([^"]*)"$/.exec(etag);
  return match ? match[1] : undefined;
}

const CONDITIONAL_METHODS = ['GET', 'HEAD'];

// The lifecycle options every HTTP adapter passes: the etag stage runs only
// for GET/HEAD (for a mutation, a tag computed before execute would describe
// the pre-mutation state), and its tag is compared against If-None-Match.
export function httpLifecycleOptions(
  method: string | undefined,
  headers: Record<string, unknown> | undefined
): LifecycleOptions {
  if (!CONDITIONAL_METHODS.includes(String(method).toUpperCase())) {
    return {};
  }
  const ifNoneMatch = headers?.['if-none-match'] as
    | string
    | string[]
    | undefined;
  return {
    resolveETag: (tag) => {
      const etag = formatETag(tag);
      return { etag, notModified: ifNoneMatchMatches(ifNoneMatch, etag) };
    },
  };
}

// The headers a successful (or 304) response carries: responseMeta's, plus
// the ETag when the etag stage produced one. The stage's tag wins over a
// hand-set ETag header, since it is the one If-None-Match was compared to.
export function responseHeaders(
  metaHeaders: Record<string, string> | undefined,
  etag: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(metaHeaders || {})) {
    if (etag === undefined || name.toLowerCase() !== 'etag') {
      headers[name] = value;
    }
  }
  if (etag !== undefined) {
    headers.ETag = etag;
  }
  return headers;
}

// Everything that happens after the response: the ctx.defer tasks (success
// and 304 only, registration order, one at a time), then afterResponse
// (success and 304 only), then finally (always). Each failure is routed to
// onError with its phase and never stops the next step; the runner itself
// never rejects. Returns undefined when there is nothing to run, so adapters
// skip scheduling entirely.
export function makeAfterResponseRunner(
  options: HttpAdapterOptions,
  outcome: {
    raw?: unknown;
    // Present only when the lifecycle succeeded (incl. 304).
    lifecycle?: LifecycleResult;
    info: () => FinallyInfo;
  }
): (() => Promise<void>) | undefined {
  const { lifecycle, raw } = outcome;
  const hasDeferred = !!lifecycle && lifecycle.deferred.size > 0;
  const hasAfterResponse = !!lifecycle && !!options.afterResponse;
  if (!hasDeferred && !hasAfterResponse && !options.finally) {
    lifecycle?.deferred.drain();
    return undefined;
  }
  const report =
    (phase: NonNullable<OnErrorInfo['phase']>) => (error: unknown) =>
      safeInvokeOnError(options.onError, error, { raw, phase });
  return async () => {
    if (lifecycle) {
      for (const task of lifecycle.deferred.drain()) {
        await settle(task, report('defer'));
      }
      const { afterResponse } = options;
      if (afterResponse) {
        await settle(
          () => afterResponse(lifecycle.context),
          report('afterResponse')
        );
      }
    }
    const { finally: finallyHook } = options;
    if (finallyHook) {
      await settle(() => finallyHook(outcome.info()), report('finally'));
    }
  };
}

// For adapters that hand the body to the framework to write (Express,
// Fastify): the framework can still turn that write into an error response of
// its own (Fastify answers an unserializable body with a 500 itself), so the
// chain is chosen when it RUNS, from the status actually sent. Success-path
// work (deferred tasks, afterResponse) never runs after an error response;
// finally then reports outcome 'error' with the sent status. Schedule the
// result only AFTER handing the response to the framework.
export function makeSentStatusAwareRunner(
  options: HttpAdapterOptions,
  outcome: {
    raw?: unknown;
    lifecycle: LifecycleResult;
    info: FinallyInfo;
    // The status on the wire, or undefined while/where it can't be read.
    sentStatus: () => number | undefined;
  }
): (() => Promise<void>) | undefined {
  const { raw, lifecycle, info, sentStatus } = outcome;
  const success = makeAfterResponseRunner(options, {
    raw,
    lifecycle,
    info: () => {
      const status = sentStatus();
      return status === undefined ? info : { ...info, status };
    },
  });
  if (!success) {
    return undefined;
  }
  const failure = makeAfterResponseRunner(options, {
    raw,
    info: () => ({ raw, outcome: 'error', status: sentStatus() }),
  });
  return async () => {
    const status = sentStatus();
    if (status !== undefined && status >= 400 && (info.status ?? 0) < 400) {
      lifecycle.deferred.drain();
      await failure?.();
      return;
    }
    await success();
  };
}

async function settle(
  fn: () => PromiseOrSync<void>,
  onFailure: (error: unknown) => void
) {
  try {
    await fn();
  } catch (error) {
    onFailure(error);
  }
}

// Invokes onError so that a broken logging hook can never break the response.
export function safeInvokeOnError(
  onError: HttpAdapterOptions['onError'],
  error: unknown,
  info: OnErrorInfo
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

// Fire-and-forget afterResponse; sync throws and async rejections can never
// affect the (already sent) response — they are routed to onError with
// phase 'afterResponse' so failed side effects stay observable.
export function safeInvokeAfterResponse(
  afterResponse: HttpAdapterOptions['afterResponse'],
  context: Record<string, unknown>,
  onError?: HttpAdapterOptions['onError'],
  raw?: unknown
) {
  if (!afterResponse) {
    return;
  }
  const report = (error: unknown) =>
    safeInvokeOnError(onError, error, { raw, phase: 'afterResponse' });
  try {
    Promise.resolve(afterResponse(context)).catch(report);
  } catch (error) {
    report(error);
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
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient })
  ) => TPreAuthOut;
  loadResources?: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut>
  ) => PromiseOrSync<TLoadResourcesOut>;
  finalAuthorize: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut>
  ) => PromiseOrSync<TFinalAuthOut>;
  execute: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<TUnsafeResponse>;
  redactResponse: (
    unsafe: PromiseResolveOrSync<TUnsafeResponse>,
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => TResponse;
  etag?: (
    context: { inputs: PromiseResolveOrSync<TSafeInputs> } & HasDefer &
      ([TAmbient] extends [never] ? {} : { ambient: TAmbient }) &
      PromiseResolveOrSync<TPreAuthOut> &
      PromiseResolveOrSync<TLoadResourcesOut> &
      PromiseResolveOrSync<TFinalAuthOut>
  ) => PromiseOrSync<ETagResult>;
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
