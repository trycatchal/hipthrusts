# HipThrusTS

[![CI](https://github.com/trycatchal/hipthrusts/actions/workflows/ci.yml/badge.svg)](https://github.com/trycatchal/hipthrusts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hipthrusts.svg)](https://www.npmjs.com/package/hipthrusts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Secure-by-default request handlers for Node.js APIs.**

You'll like HipThrusTS if you're building a Node.js API with a data model,
untrusted clients, and at least one of these concerns:

- resource-level access control (owner-only, role-based, assignee-based)
- field-level permissions (some fields are read-only for some callers)
- response redaction (passwords, tokens, internal flags must never leak)
- making security review of every endpoint mechanical, not human

HipThrusTS is a small TypeScript library that gives every endpoint the same
five-stage shape: validate inputs, authorize, load resources, do the work,
redact the response. The framework refuses to build a handler that skips
any of those required stages — so the dangerous shortcuts a busy reviewer
might miss in a 200-line Express middleware become impossible to ship.

It sits on top of the framework you already use — Express, tRPC, Hono,
Fastify, or Next.js (App Router). It doesn't replace your router, your ORM,
or your auth layer — it gives the per-request handler a backbone.

```ts
import { toExpressHandler } from 'hipthrusts/express';

app.get('/things/:id', toExpressHandler({
  extractAmbient:  (raw)    => ({ user: raw.req.user }),
  sanitizeInputs:  (inputs) => ({ id: String(inputs.params.id) }),
  preAuthorize:    (ctx)   => ctx.ambient.user?.role === 'reader',
  loadResources:   async (ctx) => ({
    thing: await ThingModel.findById(ctx.inputs.id).exec(),
  }),
  finalAuthorize:  (ctx)   =>
    !!ctx.thing && ctx.thing.ownerId === ctx.ambient.user.id,
  execute:         (ctx)   => ctx.thing,
  redactResponse:  (thing) => ({ id: thing.id, name: thing.name }),
}));
```

Forget any of the five required stages and TypeScript fails the build.
Throw a `HipError` (`HipNotFound`, `HipForbidden`, …) from any stage and the
adapter translates it to the right HTTP response — without leaking error
details to the caller.

## Why HipThrusTS

Every secure HTTP handler does the same five things, whether you write
them down or not:

1. **Sanitize inputs.** Untrusted data in. Validated, typed shape out.
2. **Pre-authorize.** Cheap, synchronous check (a JWT role, an API key)
   before you touch the database.
3. **Load resources, then final-authorize.** Fetch the resource the
   request is about; check ownership/permissions with it in hand.
4. **Execute.** Do the work.
5. **Redact the response.** Strip fields the caller isn't allowed to see.

(Plus optional "lift ambient" and "extract inputs" steps for projecting
the request envelope — useful but not security-load-bearing.)

Most frameworks make all of these optional. The handler that forgets one
still ships, still compiles, still passes basic tests. The bug appears in
production six months later as a privilege-escalation report.

HipThrusTS makes the stages **the unit of work**:

- **Mandatory by construction.** `toExpressHandler` (and every other
  adapter) won't accept a config missing a required stage — it's a type
  error.
- **Composable.** Each stage is a pure function. Share the
  "AuthorizeOwner" or "WithUserFromJWT" fragment across every endpoint
  that needs it. `HTPipe` chains them with full type inference, so later
  stages see the data earlier stages produced.
- **Failure-routed.** Throw `HipBadInputs` from `sanitizeInputs`,
  `HipForbidden` from auth, `HipNotFound` from `loadResources`,
  `HipConflict` from `execute` — the adapter translates each one to the
  right HTTP status (or `TRPCError` code for tRPC). Anything else thrown
  becomes a `500` with no stack-trace leak.
- **Adapter-thin.** Express, tRPC, Hono, Fastify, and Next.js (App
  Router) today; anything else in a ~100-line file tomorrow. The
  lifecycle is framework-agnostic.

## Install

```sh
pnpm add hipthrusts
# peer-installs depending on what you'll use:
pnpm add express              # Express adapter
pnpm add hono                 # Hono adapter
pnpm add fastify              # Fastify adapter
pnpm add next                 # Next.js (App Router) adapter
pnpm add zod                  # Zod-based validation helpers
pnpm add mongoose json-mask   # Mongoose helpers
```

The package ships both ESM and CommonJS builds — `import` and `require`
both work, for the root and for every subpath (`hipthrusts/express`,
`hipthrusts/zod`, …). Node.js >= 20.

Subpath types are resolved through the package `exports` map, so your
`tsconfig.json` needs `"moduleResolution": "node16"`, `"nodenext"`, or
`"bundler"`. The legacy `"node"` (node10) resolution cannot see the
subpath type declarations.

## The lifecycle, in detail

Prefer pictures? [docs/architecture.md](./docs/architecture.md) has
diagrams of the lifecycle, failure routing, context accumulation,
`HTPipe` composition, and the adapter surface.

Every handler config is a plain object. Five methods are required; three
are optional. Each method receives a `context` that accumulates as the
request progresses, so a later stage sees everything earlier stages
returned.

| Stage             | Req? | Async? | Receives                       | Use this for…                                              |
|-------------------|------|--------|--------------------------------|------------------------------------------------------------|
| `extractAmbient`  | no   | sync   | raw request                    | lift trusted ambient (auth principal, request ID, locale)  |
| `extractInputs`   | no   | sync   | adapter-canonical raw inputs   | adapter-specific input shaping (rarely needed)             |
| `sanitizeInputs`  | yes  | sync   | unsafe inputs                  | validate untrusted user input against your schema          |
| `preAuthorize`    | yes  | sync   | `{ inputs, ambient }`          | cheap check before touching the database                   |
| `loadResources`   | no   | async  | everything so far              | fetch the resource the request is about                    |
| `finalAuthorize`  | yes  | async  | everything so far              | ownership/permission check with the resource in hand       |
| `execute`         | yes  | async  | everything so far              | the actual work (mutate, compute, save)                    |
| `redactResponse`  | yes  | sync   | unsafe response, final context | strip secrets/internal fields before sending               |

`extractAmbient`'s output lives at `ctx.ambient`. `sanitizeInputs`'s output
lives at `ctx.inputs`. Outputs from `preAuthorize` / `loadResources` /
`finalAuthorize` are spread at the top level of `ctx`.

Authorization stages return `true` to pass, `false` to deny, or an
**object** to pass *and* contribute that object to the context. So
`finalAuthorize` can do its check and produce the resource role at the
same time:

```ts
finalAuthorize: (ctx) =>
  ctx.thing.ownerId === ctx.ambient.user.id
    ? { isOwner: true as const }
    : false,
```

…and `execute` will see `ctx.isOwner` with full type information.

`redactResponse` optionally takes the final context as a second
argument, so redaction can depend on the caller — no need to smuggle
authorization flags through the `execute` return value:

```ts
finalAuthorize: (ctx) => ({ canSeeEmails: ctx.ambient.user.role === 'admin' }),
execute:        (ctx) => ({ rows: ctx.rows }),
redactResponse: (unsafe, ctx: { canSeeEmails: boolean }) =>
  ctx.canSeeEmails ? unsafe.rows : unsafe.rows.map(({ email, ...rest }) => rest),
```

### Input slices & the strictness guarantee

`sanitizeInputs` is single-slot: one function, unsafe in, safe out —
which is exactly right for tRPC's single `input`. HTTP-style adapters
feed it the canonical `{ params, query, body, headers }` object, and
`SanitizeInputsSlices` gives you per-slice ergonomics on top:

```ts
SanitizeInputsSlices({
  params: (p) => ParamsSchema.parse(p),
  body:   (b) => BodySchema.parse(b),
})
```

**Only slices you explicitly sanitize survive the stage.** Chained
sanitize fragments hand the raw remainder to each other under the
`UNSAFE_SLICES` symbol, and core deletes that channel once the stage
completes — so an unsanitized `query` never reaches `preAuthorize` or
anything after it, at runtime *or* in the types (consuming it downstream
is a compile error). Want a raw slice through? Say so explicitly:
`{ query: (q) => q }`. A plain whole-object sanitizer
(`sanitizeInputs: (i) => …`) is likewise an explicit mapping — whatever
it returns is, by definition, sanitized.

## Compose, don't repeat yourself

The real payoff shows up the second time you need "load a Thing by ID,
require the caller to own it." Write it once:

```ts
import { HTPipe, LoadResources, FinalAuthorize, ExtractAmbient } from 'hipthrusts';

// Lift the authenticated user out of the raw request once.
export const WithUserFromReq = ExtractAmbient((raw: { req: { user?: any } }) => ({
  user: raw.req.user,
}));

// Load the addressed Thing and require that the caller owns it.
export const RequireThingOwner = HTPipe(
  LoadResources(async (ctx: { inputs: { params: { id: string } } }) => ({
    thing: await ThingModel.findById(ctx.inputs.params.id).exec(),
  })),
  FinalAuthorize((ctx: { thing: any; ambient: { user: { id: string } } }) =>
    ctx.thing && ctx.thing.ownerId === ctx.ambient.user.id
      ? { isOwner: true as const }
      : false,
  ),
);
```

Then use it in every handler that needs it:

```ts
import { HTPipe, SanitizeInputsSlices } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';

app.put('/things/:id', toExpressHandler(HTPipe(
  WithUserFromReq,                                       // ambient.user
  SanitizeInputsSlices({
    params: (p: any) => ({ id: String(p.id) }),
    body:   (b: any) => ({ name: String(b.name) }),
  }),
  RequireThingOwner,                                     // shared fragment
  {
    preAuthorize:   (ctx) => ctx.ambient.user?.role === 'editor',
    execute:        async (ctx) => {
      ctx.thing.name = ctx.inputs.body.name;
      return ctx.thing.save();
    },
    redactResponse: (t) => ({ id: t.id, name: t.name }),
  },
)));
```

`HTPipe` walks each stage left-to-right, threading the context through
and intersecting types so an `execute` written here knows it can reach
`ctx.thing`, `ctx.ambient.user`, `ctx.inputs.params.id`, and `ctx.isOwner`.

### A small routes file

The same shared fragments power every endpoint in a router:

```ts
import { HTPipe, SanitizeInputsSlices } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';
import { WithUserFromReq, RequireThingOwner } from './shared';

// GET /things — public list, no resource load
thingRouter.get('/', toExpressHandler({
  sanitizeInputs:  () => ({}),
  preAuthorize:    () => true,
  finalAuthorize:  () => true,
  execute:         () => ThingModel.find({}, { _id: 1, name: 1 }).lean(),
  redactResponse:  (rows) => rows.map((r) => ({ id: r._id, name: r.name })),
}));

// GET /things/:id — owner-only read
thingRouter.get('/:id', toExpressHandler(HTPipe(
  WithUserFromReq,
  SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
  RequireThingOwner,
  {
    preAuthorize:   () => true,
    execute:        (ctx) => ctx.thing,
    redactResponse: (t) => ({ id: t.id, name: t.name, ownerId: t.ownerId }),
  },
)));

// PUT /things/:id — owner-only update
thingRouter.put('/:id', toExpressHandler(HTPipe(
  WithUserFromReq,
  SanitizeInputsSlices({
    params: (p: any) => ({ id: String(p.id) }),
    body:   (b: any) => ({ name: String(b.name) }),
  }),
  RequireThingOwner,
  {
    preAuthorize:   (ctx) => ctx.ambient.user?.role === 'editor',
    execute:        async (ctx) => {
      ctx.thing.name = ctx.inputs.body.name;
      return ctx.thing.save();
    },
    redactResponse: (t) => ({ id: t.id, name: t.name }),
  },
)));
```

`RequireThingOwner` was authored once and is dropped into every endpoint
that needs ownership. Adding a `/things/:id/archive` endpoint takes
roughly four lines.

### Partial pipelines are the reuse unit

The currying story: export a **partial pipeline** — auth, sanitization,
loaders, anything shared — and compose it first in every endpoint. A
typical auth pipeline lifts the (maybe-absent) principal in
`extractAmbient` (lift-only, no denial there), then denies *and*
contributes in `preAuthorize`. Contribute the whole principal — including
per-request authorization data like access rows — so later stages never
re-fetch it:

```ts
// Lift only — extraction never denies.
const WithMaybePrincipal = ExtractAmbient((raw: NextRaw) => ({
  principal: raw.principal as Principal | null, // from gatherContext
}));

// Deny AND contribute: after this, ctx.principal is non-null downstream.
const RequireAuthenticated = PreAuthorize(
  (ctx: { ambient: { principal: Principal | null } }) =>
    ctx.ambient.principal
      ? { principal: ctx.ambient.principal } // carries its access rows
      : false,
);

export const Authed = HTPipe(WithMaybePrincipal, RequireAuthenticated);
```

### finishPipe: an inferred trailing handler

Stage callbacks inside `HTPipe` fragments must declare the context they
consume — `HTPipe` infers its types FROM the fragments, so contextual
typing can't flow INTO them. For the dominant authoring shape — a shared
partial pipeline plus ONE endpoint-specific trailing handler — use
`finishPipe`: it computes the pipe's accumulated context from the pipe's
*type*, so the trailing stages need **zero annotations**:

```ts
import { finishPipe } from 'hipthrusts';

export const GET = toNextHandler(finishPipe(
  HTPipe(Authed, SanitizeInputsSlicesWithZod({ params: Params })),
  {
    loadResources:  async (ctx) => ({          // ctx fully inferred:
      thing: await ThingModel.findById(ctx.inputs.params.id).lean().exec(),
    }),                                        //   principal, inputs, ambient…
    finalAuthorize: (ctx) => ctx.thing?.ownerId === ctx.principal.id,
    execute:        (ctx) => ctx.thing,
    redactResponse: (unsafe) => unsafe,
  },
), { gatherContext });
```

Consuming a context key nothing provides is a compile error, and
pipe-internal requirements (like the scoped finders' `queryScope`) still
surface as `HipDepNotMet` at the adapter boundary. Runtime is literally
`HTPipe(pipe, handler)`.

Limitations, by design: the trailing handler may only declare
`preAuthorize` / `loadResources` / `finalAuthorize` / `execute` /
`redactResponse` / `responseMeta`. Extraction and sanitization stages
describe the pipeline's input surface — author them in the pipe. The
exported `PipeContext<typeof SomePipe>` utility computes a pipe's
accumulated context type if you need it by hand.

Division of labor with the per-adapter `defineXHandler` helpers: those
give contextual typing to a single *whole* config object (and are the
only way to get a typed adapter-raw parameter in `extractAmbient`);
`finishPipe` covers the shared-pipe-plus-trailing-handler shape. With
partial pipelines, `finishPipe` is usually the one you want.

## Errors

The lifecycle has a small, semantic error vocabulary. Throw one of these
from any stage and the adapter takes care of the HTTP details:

| Throw                | HTTP                  | Meaning                                          |
|----------------------|-----------------------|--------------------------------------------------|
| `HipBadInputs(msg)`  | 422                   | Input validation failed.                         |
| `HipUnauthorized()`  | 401                   | No authenticated principal.                      |
| `HipForbidden()`     | 403                   | Authenticated, but not permitted.                |
| `HipNotFound()`      | 404                   | A required resource is missing.                  |
| `HipConflict()`      | 409                   | The request conflicts with current state.        |
| `HipInternal()`      | 500                   | Unexpected failure (default for anything else).  |
| `new HipRedirect(u)` | 302 (or what you set) | Control-flow signal; HTTP-style adapters honor.  |

Every HTTP adapter (**Express / Hono / Fastify / Next.js**) responds
directly with the mapped status and a JSON body. If you'd rather have
your own express error middleware handle errors, pass
`{ delegateErrors: true }` to `toExpressHandler` — every error (the
`HipError` itself, or the raw unknown exception) is forwarded to
`next()`, and `hipErrorToStatus` / `hipErrorToBody` from
`hipthrusts/errors` do the translation in your middleware. The **tRPC**
adapter lets `HipError` propagate with its `.kind`; map it in your
`errorFormatter` if you want specific `TRPCError` codes.

### What the error body contains

The HTTP error body is `{ error, issues?, detail? }`:

- `error` — the message, always.
- `issues` — when the error's `detail` is a `ZodError` (as thrown by the
  zod helpers), it is projected to `[{ path, message }]` so forms can
  render per-field errors. Paths and messages only — received input
  values never reach the wire.
- `detail` — arbitrary structured payload, included **only** when the
  error was constructed with the explicit opt-in:

  ```ts
  throw new HipConflict('blocked by open items', { blockedBy }, { expose: true });
  // -> 409 { "error": "blocked by open items", "detail": { "blockedBy": [...] } }
  ```

`HipInternal` never exposes `issues` or `detail`, opt-in or not.

### Unexpected errors

Anything thrown that *isn't* a `HipError` is scrubbed and routed by
stage. The input stages (`extractInputs` / `sanitizeInputs`) map unknown
throws to `422` (they exist to reject bad input — a raw `schema.parse()`
works fine there). Every other stage — `extractAmbient`, `preAuthorize`,
`loadResources`, `finalAuthorize`, `execute` — maps them to a `500` with
the body `{ "error": "Internal server error" }`, because an unexpected
throw there is an app bug or infra failure, not a client-attributable
outcome. In particular `extractAmbient` runs *before* any input is
validated and merely lifts trusted ambient (auth principal, request id,
locale) off the raw request, so a crash there says nothing about the
caller's input and is deliberately **not** a `422` (nor a default `401` —
an outage in ambient extraction must not masquerade as an auth failure).
The original error is chained as `Error.cause` on the `HipError`, so the
adapters' `onError` hook (below) can log the real failure.

A *deliberate* status from `extractAmbient` stays fully expressible: throw
a `HipError` (e.g. `HipUnauthorized`) and it passes through unwrapped —
this is what powers the auth-before-validation gate below.

> **403 vs 404:** `finalAuthorize` returning `false` is always a `403`.
> If "the resource doesn't exist" should read as `404`, throw
> `HipNotFound` from `loadResources` (the mongoose helper
> `findByIdRequired` does exactly this). A `loadResources` that merely
> returns nothing is NOT a 404 by itself.

### Rejecting a caller before validating their inputs (the auth gate)

The default lifecycle validates first: `extractInputs` / `sanitizeInputs`
run before `preAuthorize`, so an unauthenticated caller who also sends a
malformed payload sees the `422` before the `401`. That ordering is the
right default — many teams want it — but it is not universal. The other
camp of the perennial 422-vs-401 debate wants authentication checked
*first*, so an anonymous caller is turned away without their inputs ever
being examined.

You don't need a framework flag or a lifecycle reorder to get it. Because
`extractAmbient` is the **first** stage and a thrown `HipError` passes
through every stage unwrapped, a tiny `extractAmbient` fragment that
*rejects* (rather than merely lifting) turns the endpoint into
auth-first — and, composed with `HTPipe`, opts in per endpoint:

```ts
import { HTPipe, ExtractAmbient, PreAuthorize } from 'hipthrusts';
import { HipUnauthorized } from 'hipthrusts/errors';

// A gate: extractAmbient runs before any input stage, so throwing here
// makes the 401 precede any 422. HipUnauthorized passes through unwrapped.
const RequireAuthenticated = ExtractAmbient(
  (raw: { principal: Principal | null }) => {
    if (!raw.principal) throw new HipUnauthorized('Please sign in');
    return { principal: raw.principal }; // narrowed: non-null downstream
  },
);

// A trivial preAuthorize lift keeps the contributed principal visible to
// later stages exactly as the validate-first `Authed` pipeline does.
const CarryPrincipal = PreAuthorize(
  (ctx: { ambient: { principal: Principal } }) => ({
    principal: ctx.ambient.principal,
  }),
);

// Auth-first: 401 before 422. Compare with the validate-first `Authed`
// pipeline earlier, which lifts a maybe-null principal and denies in
// preAuthorize (so input validation runs first). Same primitives — the
// only difference is WHERE the rejection lives.
export const AuthedFirst = HTPipe(RequireAuthenticated, CarryPrincipal);
```

Both orderings fall out of the same primitives: keep the rejection in
`preAuthorize` for validate-first, move it up into `extractAmbient` for
auth-first. Neither camp needs a framework change.

What the gate does **not** preempt: the HTTP adapters read and JSON-parse
the request body, and run `gatherContext`, *before* the lifecycle starts.
So a malformed JSON body can still produce a `422` (or a `gatherContext`
failure its own error) ahead of the gate's `401`; the gate governs stage
ordering, not the transport-level parse that precedes every stage.

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
  // after a successful lifecycle; never blocks or breaks the response
  // (failures are routed to onError, above).
  afterResponse: async (ctx) => auditLog.write({ input: ctx.inputs, out: ctx.response }),
});
```

Repeating the same options on every route? Each adapter exports a preset
factory — `makeExpressHandlerFactory`, `makeHonoHandlerFactory`,
`makeFastifyHandlerFactory`, `makeNextHandlerFactory` — that bakes
defaults into a reusable converter (per-call options merge over them):

```ts
export const toAppHandler = makeNextHandlerFactory({ gatherContext, onError });
// ...
export const GET = toAppHandler(handler); // no repeated { gatherContext }
```

The Next.js and Hono adapters (which parse JSON bodies themselves)
additionally reject non-empty bodies that fail to parse with a
`422 { "error": "Malformed JSON body" }` — pass
`allowMalformedBody: true` to coerce them to `{}` instead. Empty bodies
always coerce to `{}`. (Express and Fastify body parsing is configured
in the framework.)

The Next.js adapter also keeps its `gatherContext` option for merging
async request context (e.g. the auth principal) into the raw envelope.

## List endpoints & tenant scoping

A list endpoint has no single resource to authorize, so `finalAuthorize:
() => true` is correct — but then the tenant filter must live in the
query itself, and forgetting it is a cross-tenant data leak. Make the
scope a *typed context dependency* instead of a convention: one fragment
contributes `queryScope`, and the scoped finders require it.

```ts
import { FindScoped } from 'hipthrusts/mongoose';

const WithTenantScope = LoadResources((ctx: { ambient: { user: User } }) => ({
  queryScope: { businessGroup: { $in: ctx.ambient.user.accessibleGroupIds } },
}));

app.get('/things', toExpressHandler(HTPipe(
  WithUserFromReq,
  WithTenantScope,
  {
    sanitizeInputs: (i) => i,
    preAuthorize:   (ctx) => !!ctx.ambient.user,
    finalAuthorize: () => true,
    ...FindScoped(ThingModel, undefined, {   // Model.find({ ...ctx.queryScope })
      sort: { createdAt: -1 },
      limit: 100,
    }),
    redactResponse: (rows) => rows.map(({ id, name }) => ({ id, name })),
  },
)));
```

`FindScoped(Model, extraFilter?, options?)` is a two-stage fragment: the
scoped `Model.find` runs on the **load** stage (so the rows sit in
context — under `scopedDocs` by default — where `finalAuthorize`, a
two-param `redactResponse`, and any downstream `execute` you pipe can
see them) plus a trivial `execute` that returns them. Its load stage
**requires** `queryScope` in its context type — drop `WithTenantScope`
from the pipe and the handler no longer compiles. The options bag takes
`{ sort, limit, skip, projection, lean, docsKey }`, so real list
endpoints keep their pagination and ordering. `LoadScopedTo(Model, key,
extraFilter?, options?)` is the load stage alone, for handlers that
post-process the scoped rows in their own `execute`. (The camelCase
`findScoped`/`loadScopedTo` names on `htMongooseFactory` remain as
aliases; a bare string third argument to `FindScoped` is still accepted
as the docs key.)

## Type troubleshooting

The deps-met machinery rejects a handler whose stages declare context
keys nothing contributes. When that happens the compiler error names the
stage and key via a branded type:

```
... is not assignable to ... HipDepNotMet<"finalAuthorize", "doc">
```

That means: `finalAuthorize` declares `ctx.doc`, and no earlier stage
(`preAuthorize` / `loadResources`) returns an object with a compatible
`doc`. Fix the provider (or the declared type), don't `as any` the
handler.

A few patterns to know:

- **Keep ORM documents narrow.** Don't let a full
  `mongoose.Document<...>` generic flow into a declared stage context —
  declare the small structural interface you actually use
  (`{ ownerId: string; save(): Promise<unknown> }`). It compiles faster
  and produces readable errors.
- **Conditional loads are fine.** `if (!doc) return {}; return { doc }`
  (a union return) counts as providing `doc`. If the consuming stage
  must handle the missing case, declare it optional/nullable there.
- **`any`-typed context keys are tolerated,** but you lose the
  guarantee that anything provides them — prefer real types.

## Validation helpers

### Zod

```ts
import { z } from 'zod';
import { HTPipe } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';
import { htZodFactory } from 'hipthrusts/zod';

const { SanitizeInputsSlicesWithZod, RedactResponseWithZod } = htZodFactory();

const Params = z.object({ id: z.string().uuid() });
const Body   = z.object({ name: z.string().min(1).max(80) });
const Resp   = z.object({ id: z.string(), name: z.string() });

app.put('/things/:id', toExpressHandler(HTPipe(
  WithUserFromReq,
  SanitizeInputsSlicesWithZod({ params: Params, body: Body }),
  RedactResponseWithZod(Resp),
  RequireThingOwner,
  {
    preAuthorize: () => true,
    execute: async (ctx) => {
      ctx.thing.name = ctx.inputs.body.name;
      return ctx.thing.save();
    },
  },
)));
```

A Zod parse failure throws `HipBadInputs` carrying the `ZodError` as
`.detail`; the adapter turns that into a
`422 { error, issues: [{ path, message }] }` response (see
[Errors](#errors)).

For partial-update endpoints, pass `Body.partial()` as the slice schema.

#### Codec-style wire schemas

Make the wire schema a zod **codec**: it accepts the STORED document and
its transforms own the whole reshape (`_id` → `id`, ObjectId → string,
Date → ISO, null-normalization). Redaction is then ONE fragment — no
mapper-then-validate two-step:

```ts
const wireCodecSchema = z
  .object({
    _id: z.instanceof(Types.ObjectId).transform(String),
    name: z.string(),
    createdAt: z.date().transform((d) => d.toISOString()),
  })
  .transform(({ _id, ...rest }) => ({ id: _id, ...rest }));

const RedactAsWire = RedactResponseWithZod(wireCodecSchema);
```

#### Switch-style redaction & sanitization

When different requests get different shapes, don't hand-branch inside
one stage — compose *simple* fragments with a switch. The core
`RedactResponseSwitch(ctxKeyPath, cases)` picks one ordinary redact
fragment by the value found at a context dot path (a key of a key works:
`'principal.role'`), and the chosen case receives the unsafe response
and the context exactly as if it were the handler's own redactor:

```ts
import { RedactResponseSwitch } from 'hipthrusts';

// "members see {names}, admins see {names, emails}" — but the switch is
// general-purpose: any context key, any simple redact fragments.
RedactResponseSwitch('canSeeEmails', {
  true: RedactResponseWithZod(adminWireSchema),
  false: RedactResponseWithZod(memberWireSchema),
});
```

The composed fragment type-REQUIRES the context key (derived from the
path string): if nothing contributes `canSeeEmails`, the handler doesn't
compile. An unmatched key at runtime is a `HipInternal` (server bug).

`SanitizeInputsSwitch(inputsKeyPath, cases)` is the same idea for the
sanitize stage. Sanitization runs before any context exists, so the
discriminator lives in the unsafe inputs themselves — the
discriminated-union endpoint story:

```ts
import { SanitizeInputsSwitch } from 'hipthrusts';

SanitizeInputsSwitch('body.kind', {
  email: SanitizeInputsSlicesWithZod({ body: EmailBody }),
  sms:   SanitizeInputsSlicesWithZod({ body: SmsBody }),
});
```

An unmatched discriminator rejects the request with `HipBadInputs`
(422). Both switches work with ANY simple fragments — zod-backed,
mongoose-backed, or hand-written `RedactResponse`/`SanitizeInputs` — the
switch is just a layer over them.

#### Deriving input schemas from document schemas

Deriving a PATCH schema from the stored-document schema has a trap: zod
fires `.default()` **even under `.partial()`**, so a derived update
schema silently injects defaulted fields into every update — e.g. every
PATCH "sends" `verificationComplete: false` and then trips your
privileged-field check with a 403. Derive input schemas with
pick/partial AND strip defaults:

```ts
// DON'T: docSchema.partial() — .default() fields materialize on every parse.
// DO: pick the client-writable fields and re-declare them default-free:
const UpdateBody = z.object({
  name: docShape.name,             // reuse field validators...
  description: docShape.description,
}).partial();                      // ...but only ones without .default()
```

If a field needs a default at CREATE time, keep the default on the
create schema (or the DB layer) — never on a schema an update derives
from.

### Mongoose

```ts
import mongoose from 'mongoose';
import { htMongooseFactory } from 'hipthrusts/mongoose';

const {
  findByIdRequired,           // throws 404 if missing
  PojoToDocument,             // builds a mongoose doc from a context key
  UpdateDocumentFromTo,       // patches a doc with ctx.inputs.body
  SaveOnDocumentFrom,         // .save() with friendly errors
} = htMongooseFactory(mongoose);
```

These compose with `HTPipe` like everything else.

#### Everyday loaders & ctxRef

The everyday findById/findOne/find `loadResources` blocks are one-liners
(module-level exports — no factory needed). Filter values and ids are
declared as **context paths** with `ctxRef`, and the fragment's context
*requirement* is derived from the path string — deps-met still enforces
that an earlier stage provides `inputs.body.user`, with zero
hand-written context annotations:

```ts
import {
  ctxRef, LoadManyTo, LoadOneTo, LoadByIdRequiredTo, LoadDocByIdRequiredTo,
} from 'hipthrusts/mongoose';

/** find -> ctx.things: Lean<Thing>[] */
LoadManyTo(ThingModel, 'things', {
  businessGroup: ctxRef('inputs.params.businessGroupId'),
  archived: false,                     // literal: passed through verbatim
})
/** findOne -> ctx.user: Lean<User> | null */
LoadOneTo(UserModel, 'user', { _id: ctxRef('inputs.body.user') })
/** findById + .lean(), throws HipNotFound -> ctx.thing: Lean<Thing> */
LoadByIdRequiredTo(ThingModel, 'thing', ctxRef('inputs.params.id'), 'No such thing')
/** findById HYDRATED (for .set()/.save() update flows), throws HipNotFound */
LoadDocByIdRequiredTo(ThingModel, 'thingDoc', ctxRef('inputs.params.id'))
```

Semantics worth knowing:

- **`$eq`-wrapping by default.** ctxRef-resolved values are wrapped in
  `{ $eq: value }` (and `undefined` entries pruned), so user-influenced
  context values can't smuggle query operators. Literal values in the
  spec are developer-authored and pass through verbatim — that's the
  escape hatch for operator filters like `{ status: { $in: [...] } }`.
  Every loader also accepts a selector function
  (`(ctx) => ({ tenant: { $in: ctx.tenantIds } })`) for computed
  filters, passed through as-is.
- **Lean by default.** `LoadManyTo`/`LoadOneTo`/`LoadByIdRequiredTo`
  read `.lean()` and type rows as `TRaw & { _id: Types.ObjectId }`, so a
  downstream stage declaring `_id` passes deps-met. Use
  `LoadDocByIdRequiredTo` when you need a hydrated document to mutate
  and save.
- **404 is the short pattern.** The `RequiredTo` variants throw
  `HipNotFound` (with your optional message) when the row is missing —
  reserving `finalAuthorize`/403 for actual permission denials.
- These are typed against mongoose's own `Model<TRaw>` via type-only
  imports (they erase at runtime; mongoose stays an optional peer), so
  the raw doc type is inferred from the model you pass.

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
read the session). `options.afterResponse` is a callback you can pass
that the adapter schedules via Next's `after()`.

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
[`src/http-adapter.ts`](./src/http-adapter.ts) — `responseMeta`, the
HipError-to-status mapping, and the canonical `{ params, query, body,
headers }` input shape are identical across them.

## No magic

The helpers (`HTPipe`, `LoadResources`, `SanitizeInputsSlices`, the
`htZodFactory` family) all just produce or compose plain objects.
Here's the opening example written longhand, with nothing but built-in
TypeScript:

```ts
import { HipBadInputs, HipForbidden, HipNotFound } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';

app.get('/things/:id', toExpressHandler({
  extractAmbient: (raw) => ({ user: raw.req.user }),
  sanitizeInputs: (inputs) => {
    if (typeof inputs.params?.id !== 'string') {
      throw new HipBadInputs('id must be a string');
    }
    return { id: inputs.params.id };
  },
  preAuthorize: (ctx) => ctx.ambient.user?.role === 'reader',
  loadResources: async (ctx) => {
    const thing = await ThingModel.findById(ctx.inputs.id).exec();
    if (!thing) throw new HipNotFound('Thing not found');
    return { thing };
  },
  finalAuthorize: (ctx) => {
    if (ctx.thing.ownerId !== ctx.ambient.user.id) {
      throw new HipForbidden();
    }
    return true;
  },
  execute: (ctx) => ctx.thing,
  redactResponse: (thing) => ({ id: thing.id, name: thing.name }),
}));
```

`HTPipe` and the wrapper helpers exist to make this composable across
endpoints — but there's no runtime magic. Every handler is just an
object literal.

## How it differs from other frameworks

Frameworks like Express, Fastify, and Hono give you a single
`(req, res) => …` callback and trust you to lay out the security
concerns inside it.

HipThrusTS makes a different trade. Each handler config describes the
lifecycle of **one** endpoint — and the context object passed between
stages is the per-request scope. The required stages give every
handler the same shape, so a security review of one endpoint teaches
you how to read every other endpoint in the codebase.

It's also intentionally an **add-on**, not a replacement. Keep your
router, your auth middleware, your ORM. Wrap individual handlers with
HipThrusTS where the security shape matters.

## Philosophy

- **Secure by default, not by convention.** The compiler enforces the
  required stages; reviewers don't have to.
- **Reusable, not opaque.** Common patterns (ownership, role checks,
  populate-this-resource) become named fragments you compose. No magic
  decorators, no global state.
- **Stay out of your way.** No DI container, no ambient providers, no
  "framework runtime." A handler is data; the adapter executes it.
- **Lean on what works.** Mongoose is great at schema validation. Zod
  is great at parsing. Express, Hono, Fastify, and Next.js are great
  at routing. HipThrusTS doesn't reimplement any of them.

## FAQ

**Do I really need five functions per endpoint?**
Yes — but you'll find authorization and data-loading patterns repeat.
Share them as `HTPipe` fragments and per-endpoint code shrinks to just
`sanitizeInputs`, `execute`, and `redactResponse` for most handlers.

**What if my route isn't CRUD?**
The stages don't constrain what `execute` does. Most non-CRUD endpoints
just have an unusual `execute` — webhook handlers, computation, calling
a third-party API, whatever. The security shape stays the same.

**Can I share context between stages?**
That *is* the model. `preAuthorize`, `loadResources`, and
`finalAuthorize` each return an object that gets merged into the
accumulating context — and downstream stages see those additions with
full type inference.

**How is `ctx.ambient` different from `ctx.inputs`?**
`ctx.ambient` is **trusted** data lifted from the request envelope (the
authenticated principal, request ID, locale) — it doesn't go through
validation. `ctx.inputs` is whatever `sanitizeInputs` returned — the
*validated* shape of untrusted user-supplied data. The split tells
reviewers at a glance which is which.

**What if my inputs aren't HTTP-slotted?**
tRPC procedures have a single `input` value rather than the HTTP
`{ params, body, query, headers }` shape; `sanitizeInputs` just parses
that single value. Other transports work the same way — the adapter
decides what `sanitizeInputs` receives.

**How do I throw an error?**
Throw a `HipError` subclass — `HipNotFound`, `HipBadInputs`,
`HipForbidden`, etc. Each adapter translates the error to the right
framework-native response. For a redirect, throw `new HipRedirect(url)`.

## Runnable examples

The [`examples/`](./examples) directory has a hello-world per adapter.
Run them straight from the repo (they import from `../src`; in your own
project you'd import from `hipthrusts/<adapter>`):

```sh
pnpm exec tsx examples/express-hello.ts
pnpm exec tsx examples/hono-hello.ts
pnpm exec tsx examples/fastify-hello.ts
# examples/next-hello.ts is a reference route file for a Next.js app
```

## Roadmap

- More adapters (Koa, others people ask for)
- More ODM integrations (Prisma, Drizzle, TypeORM)
- A higher-level "resource recipe" layer that derives a full CRUD
  handler set from `{ resource, principals, operations }`
- A starter template

HipThrusTS is stable as of 1.0.0 and follows
[semantic versioning](https://semver.org): breaking changes to the public
API land only in major releases. See [ROADMAP.md](./ROADMAP.md) for what's
next. PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT.

## About the name

A hip thrust is an exercise — invented by Dr. Bret Contreras — that
strengthens the glutes. This library strengthens your back end. The
pun was approved by Dr. Contreras himself; if fitness is your thing,
check out [his work](https://bretcontreras.com/).
