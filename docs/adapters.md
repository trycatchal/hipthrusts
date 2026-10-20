# Adapters

*Part of the [HipThrusTS docs](./README.md) · [← back to the overview](../README.md)*

The middle is framework-free; only the edges know what framework you're
on. **Endpoint adapters** (~100 lines each) canonicalize the raw request
on the way in and translate the outcome on the way out. **Stage
factories** — Zod for validating inputs and redacting responses against
schemas, Mongoose for loading, role/assignee helpers for authorization —
emit fragments for one specific stage. The same handler object runs
unchanged under any of them.

![Endpoint adapters wrap the handler's edges; stage factories plug fragments into single stages](./img/adapters.svg)

## HTTP response metadata

HTTP-style adapters (Express, Hono, Fastify, Next.js) accept an optional
`responseMeta` field on the handler config. Use it for non-200 statuses
or response headers without leaving the declarative shape:

```ts
toExpressHandler({
  sanitizeInputs:  (i) => i,
  preAuthorize:    () => true,
  finalAuthorize:  () => true,
  execute:         (ctx) => ThingModel.create(ctx.inputs.body),
  redactResponse:  (t) => ({ id: t.id, name: t.name }),
  responseMeta:    (ctx) => ({
    status: 201,
    headers: { Location: `/things/${ctx.response.id}` },
  }),
});
```

`responseMeta` can be a static object (`{ status: 201 }`) or a function
of the final context. tRPC has no `responseMeta` — procedures return
values, not HTTP responses.

`responseMeta` (like any non-stage key) passes through `HTPipe`
composition with right-wins semantics, so it can live on any fragment.

## Adapter options

Every HTTP adapter (`toExpressHandler`, `toHonoHandler`,
`toFastifyHandler`, `toNextHandler`) takes an options object as its
second argument:

```ts
toNextHandler(handler, {
  // Called with every error the adapter converts to an error response
  // (redirects excluded). For unexpected failures, error.cause carries
  // the original underlying error. A throwing hook never affects the
  // response. Errors thrown from afterResponse also land here, tagged
  // with info.phase === 'afterResponse' — a failed audit write is
  // observable even though the response was already sent.
  onError: (error, { raw, phase }) => logger.error({ err: error, phase }),

  // Post-response side effects with the FINAL lifecycle context —
  // inputs, ambient, loaded resources, and the response. Fires only
  // after a successful lifecycle (a 304 counts); never blocks or breaks
  // the response (failures are routed to onError, above).
  afterResponse: async (ctx) => auditLog.write({ input: ctx.inputs, out: ctx.response }),

  // Runs once per request, after the response, after every ctx.defer task
  // and afterResponse have settled — for EVERY outcome: success, 304,
  // redirect, HipError, unexpected 500. info: { outcome, status, error, raw }.
  // Failures are routed to onError with phase 'finally'.
  finally: () => flushLogs(),

  // Overrides how the post-response work is scheduled (see below). The
  // test seam: collect the runner and await it.
  scheduleAfterResponse: (run) => pending.push(run),
});
```

`onError`'s `info.phase` tells request errors (no phase) from the ones
that happened after the response was sent: `'defer'` (a `ctx.defer`
task), `'afterResponse'`, `'finally'`.

Repeating the same options on every route? Each adapter exports a preset
factory — `makeExpressHandlerFactory`, `makeHonoHandlerFactory`,
`makeFastifyHandlerFactory`, `makeNextHandlerFactory` — that bakes
defaults into a reusable converter (per-call options merge over them):

```ts
export const toAppHandler = makeNextHandlerFactory({ gatherContext, onError });
// ...
export const GET = toAppHandler(handler); // no repeated { gatherContext }
```

## Post-response work

Three things can run after the response, always in this order: the
[`ctx.defer`](./lifecycle.md#post-response-work-ctxdefer) tasks the
stages registered (one at a time, in registration order), then
`afterResponse`, then `finally`. The first two run only after a
successful response (including a `304`); `finally` runs for every
outcome. A response whose write fails (a body that can't be serialized)
counts as failed. Nothing in this chain can affect the response, and a failure in
one step never skips the next — each is routed to `onError` with its
phase. When there is nothing to run, nothing is scheduled.

Each adapter schedules the chain with its framework's own
after-the-response mechanism:

| Adapter | Default scheduling |
|---------|--------------------|
| Next.js | `after()` from `next/server` (keeps the serverless function alive until it settles); fire-and-forget outside a request scope |
| Hono    | `c.executionCtx.waitUntil()` on edge runtimes; a `setTimeout` task on Node |
| Express | the Node response's `finish` (or `close`, for an aborted response) event |
| Fastify | the raw Node response's `finish` / `close` event |
| tRPC    | no response lifecycle: a `setTimeout` task after the procedure resolves (fire-and-forget) |

`scheduleAfterResponse: (run) => void` replaces the default. `run`
returns a promise that never rejects, so tests (and apps that call
handlers directly) can collect it and await it deterministically:

```ts
const pending: Array<() => Promise<void>> = [];
const GET = makeRollupHandler({ scheduleAfterResponse: (run) => pending.push(run) });

const res = await GET(request, routeCtx);
await Promise.all(pending.map((run) => run()));   // deferred work done
```

With `finally` in the preset factory, per-route boilerplate such as
Next's `after(flushLogs)` disappears:

```ts
export const toAppHandler = makeNextHandlerFactory({ gatherContext, onError, finally: flushLogs });
```

## Conditional GET (304)

When a handler declares an [`etag` stage](./lifecycle.md#conditional-get-the-etag-stage),
every HTTP adapter handles revalidation the same way, for `GET` and
`HEAD` only:

- **Match** (`If-None-Match` lists the tag, weakly compared, or is `*`):
  `304` with **no body**, carrying the `ETag` header and `responseMeta`'s
  headers (`Cache-Control`, …). `execute` and `redactResponse` don't run,
  so the context `afterResponse` and a functional `responseMeta` receive
  has **no `response`** (nor execute output keys). `finishPipe` types that;
  in a hand-written `toXHandler` config, guard `ctx.response`.
- **Miss / no `If-None-Match`:** the usual response, plus the `ETag`
  header.
- **The stage returned `null`:** the usual response, no `ETag`.

The comparison and formatting live in one place,
[`src/http-adapter.ts`](../src/http-adapter.ts) (`ifNoneMatchMatches`,
`formatETag`), and are exported for custom adapters. tRPC has no HTTP
caching and never runs the stage.

The Next.js and Hono adapters (which parse JSON bodies themselves)
additionally reject non-empty bodies that fail to parse with a
`422 { "error": "Malformed JSON body" }` — pass
`allowMalformedBody: true` to coerce them to `{}` instead. Empty bodies
always coerce to `{}`. (Express and Fastify body parsing is configured
in the framework.)

The Next.js adapter also keeps its `gatherContext` option for merging
async request context (e.g. the auth principal) into the raw envelope.


## tRPC adapter

The same handler config works with tRPC; only the adapter changes:

```ts
import { toTrpcProcedure } from 'hipthrusts/trpc';

export const updateThing = t.procedure
  .input(z.object({ id: z.string(), name: z.string() }))
  .mutation(toTrpcProcedure({
    extractAmbient:  (raw) => ({ user: raw.ctx.user }),
    sanitizeInputs:  (i)   => i,
    preAuthorize:    (ctx) => !!ctx.ambient.user,
    finalAuthorize:  ()    => true,
    execute:         async (ctx) =>
      ThingModel.findByIdAndUpdate(ctx.inputs.id, { name: ctx.inputs.name }),
    redactResponse:  (t)   => ({ id: t.id, name: t.name }),
  }));
```

The lifecycle, the type-checking, the failure routing — all identical
to the Express path. Anything reusable you build (auth fragments,
ownership checks, response shapers) works across both.

`toTrpcProcedure` takes an optional second argument with the
post-response options that make sense without an HTTP response:
`finally`, `scheduleAfterResponse`, and `onError` — which here sees only
post-response failures (`phase: 'defer' | 'finally'`); lifecycle errors
propagate to tRPC as before. `ctx.defer` tasks run after the procedure
resolves successfully. There is no `etag` stage and no `responseMeta`.

Note the input shape: tRPC procedures have a single `input` value rather
than the HTTP `{ params, body, query, headers }` shape, so
`sanitizeInputs` just parses that single value. Other transports work
the same way — the adapter decides what `sanitizeInputs` receives.

## Hono adapter

```ts
import { Hono } from 'hono';
import { toHonoHandler } from 'hipthrusts/hono';

const app = new Hono();

app.get('/things/:id', toHonoHandler({
  extractAmbient:  (raw)    => ({ user: raw.c.get('user') }),
  sanitizeInputs:  (inputs) => ({ id: String(inputs.params.id) }),
  preAuthorize:    (ctx) => !!ctx.ambient.user,
  loadResources:   async (ctx) => ({
    thing: await ThingModel.findById(ctx.inputs.id).exec(),
  }),
  finalAuthorize:  (ctx) => ctx.thing?.ownerId === ctx.ambient.user.id,
  execute:         (ctx) => ctx.thing,
  redactResponse:  (t)   => ({ id: t.id, name: t.name }),
}));
```

The adapter parses the JSON body for non-`GET`/`HEAD`/`DELETE` methods
before the synchronous lifecycle runs; the handler always sees the
parsed value in `raw.body`. The hono `Context` is available as `raw.c`
if you need it (e.g. cookies, session middleware values).

## Fastify adapter

```ts
import Fastify from 'fastify';
import { toFastifyHandler } from 'hipthrusts/fastify';

const app = Fastify();

app.put('/things/:id', toFastifyHandler({
  extractAmbient:  (raw)    => ({ user: (raw.req as any).user }),
  sanitizeInputs:  (inputs) => ({
    id:   String(inputs.params.id),
    name: String((inputs.body as any).name),
  }),
  preAuthorize:    (ctx) => !!ctx.ambient.user,
  finalAuthorize:  () => true,
  execute:         async (ctx) =>
    ThingModel.findByIdAndUpdate(ctx.inputs.id, { name: ctx.inputs.name }),
  redactResponse:  (t) => ({ id: t.id, name: t.name }),
}));
```

Fastify already parses `params`, `query`, and `body` for you, so the
adapter just hands them through.

## Next.js (App Router) adapter

```ts
// app/things/[id]/route.ts
import { toNextHandler } from 'hipthrusts/next';
import { readSession } from '@/lib/session';

export const GET = toNextHandler(
  {
    extractAmbient:  (raw)    => ({ user: raw.user }),
    sanitizeInputs:  (inputs) => ({ id: String(inputs.params.id) }),
    preAuthorize:    (ctx) => !!ctx.ambient.user,
    loadResources:   async (ctx) => ({
      thing: await ThingModel.findById(ctx.inputs.id).exec(),
    }),
    finalAuthorize:  (ctx) => ctx.thing?.ownerId === ctx.ambient.user.id,
    execute:         (ctx) => ctx.thing,
    redactResponse:  (t)   => ({ id: t.id, name: t.name }),
  },
  {
    // Async setup that runs before the lifecycle; its result is merged
    // into `raw` so extractAmbient (and any other stage) can read it.
    gatherContext: async (req) => ({ user: await readSession(req) }),
  },
);
```

`toNextHandler` returns a function with the App Router signature
`(req, { params }) => NextResponse`. Use `gatherContext` for async work
that needs to happen *before* the synchronous lifecycle (most often:
read the session). All [post-response work](#post-response-work) —
`ctx.defer` tasks, `options.afterResponse`, `options.finally` — is
scheduled via Next's `after()`.

## Defining handlers away from the route

Each adapter also exports an inference-friendly identity helper —
`defineExpressHandler`, `defineHonoHandler`, `defineFastifyHandler`,
`defineNextHandler`, and `defineTrpcProcedure` — for authoring a config
separately from where it's mounted, without losing type checking:

```ts
import { defineExpressHandler, toExpressHandler } from 'hipthrusts/express';

export const getThing = defineExpressHandler({
  extractAmbient:  (raw)    => ({ user: raw.req.user }),
  sanitizeInputs:  (inputs) => ({ id: String(inputs.params.id) }),
  preAuthorize:    (ctx)    => !!ctx.ambient.user,
  finalAuthorize:  ()       => true,
  execute:         (ctx)    => ({ id: ctx.inputs.id }),
  redactResponse:  (t)      => t,
});

// elsewhere:
app.get('/things/:id', toExpressHandler(getThing));
```

All four HTTP-style adapters share a single baseline in
[`src/http-adapter.ts`](../src/http-adapter.ts) — `responseMeta`, the
HipError-to-status mapping, and the canonical `{ params, query, body,
headers }` input shape are identical across them.

