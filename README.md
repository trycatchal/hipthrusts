# HipThrusTS

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
  extractAmbient:  (raw)   => ({ user: raw.req.user }),
  sanitizeInputs:  (raw)   => ({ id: String(raw.params.id) }),
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
pnpm add express @hapi/boom   # Express adapter
pnpm add hono                 # Hono adapter
pnpm add fastify              # Fastify adapter
pnpm add next                 # Next.js (App Router) adapter
pnpm add zod                  # Zod-based validation helpers
pnpm add mongoose             # Mongoose helpers
```

## The lifecycle, in detail

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
| `redactResponse`  | yes  | sync   | unsafe response                | strip secrets/internal fields before sending               |

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
import { HTPipe, WithInputSlice } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';

app.put('/things/:id', toExpressHandler(HTPipe(
  WithUserFromReq,                                       // ambient.user
  WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
  WithInputSlice('body',   (b: any) => ({ name: String(b.name) })),
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
import { HTPipe, WithInputSlice } from 'hipthrusts';
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
  WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
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
  WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
  WithInputSlice('body',   (b: any) => ({ name: String(b.name) })),
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

Adapters translate per their framework: the **Express** adapter maps to
**Boom** so your existing error middleware keeps working unchanged. The
**Hono / Fastify / Next.js** adapters respond directly with the mapped
status and `{ error: message }`. The **tRPC** adapter lets `HipError`
propagate with its `.kind`; map it in your `errorFormatter` if you want
specific `TRPCError` codes.

Anything thrown that *isn't* a `HipError` becomes a `500` with the
message scrubbed.

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

## Validation helpers

### Zod

```ts
import { z } from 'zod';
import { HTPipe } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';
import { htZodFactory } from 'hipthrusts/zod';

const { SanitizeInputsSliceWithZod, RedactResponseWithZod } = htZodFactory();

const Params = z.object({ id: z.string().uuid() });
const Body   = z.object({ name: z.string().min(1).max(80) });
const Resp   = z.object({ id: z.string(), name: z.string() });

app.put('/things/:id', toExpressHandler(HTPipe(
  WithUserFromReq,
  SanitizeInputsSliceWithZod('params', Params),
  SanitizeInputsSliceWithZod('body',   Body),
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

A Zod parse failure throws `HipBadInputs` (with the issue list as
`.detail`); the adapter turns that into a 422.

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
  extractAmbient:  (raw) => ({ user: raw.c.get('user') }),
  sanitizeInputs:  (raw) => ({ id: String(raw.params.id) }),
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
  extractAmbient:  (raw) => ({ user: (raw.req as any).user }),
  sanitizeInputs:  (raw) => ({
    id:   String(raw.params.id),
    name: String((raw.body as any).name),
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
    extractAmbient:  (raw) => ({ user: raw.user }),
    sanitizeInputs:  (raw) => ({ id: String(raw.params.id) }),
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

All four HTTP-style adapters share a single baseline in
[`src/http-adapter.ts`](./src/http-adapter.ts) — `responseMeta`, the
HipError-to-status mapping, and the canonical `{ params, query, body,
headers }` input shape are identical across them.

## No magic

The helpers (`HTPipe`, `LoadResources`, `WithInputSlice`, the
`htZodFactory` family) all just produce or compose plain objects.
Here's the opening example written longhand, with nothing but built-in
TypeScript:

```ts
import { HipBadInputs, HipForbidden, HipNotFound } from 'hipthrusts';
import { toExpressHandler } from 'hipthrusts/express';

app.get('/things/:id', toExpressHandler({
  extractAmbient: (raw) => ({ user: raw.req.user }),
  sanitizeInputs: (raw) => {
    if (typeof raw.params?.id !== 'string') {
      throw new HipBadInputs('id must be a string');
    }
    return { id: raw.params.id };
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

## Roadmap

- More adapters (Koa, others people ask for)
- More ODM integrations (Prisma, Drizzle, TypeORM)
- A higher-level "resource recipe" layer that derives a full CRUD
  handler set from `{ resource, principals, operations }`
- A starter template

PRs welcome.

## License

MIT.

## About the name

A hip thrust is an exercise — invented by Dr. Bret Contreras — that
strengthens the glutes. This library strengthens your back end. The
pun was approved by Dr. Contreras himself; if fitness is your thing,
check out [his work](https://bretcontreras.com/).
