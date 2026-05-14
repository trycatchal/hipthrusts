# HipThrusTS

**Secure-by-default request handlers for Node.js APIs.**

HipThrusTS is a small TypeScript library that gives every HTTP (or tRPC)
endpoint the same five-stage shape: validate inputs, authorize, load data,
do the work, sanitize the response. The framework refuses to build a
handler that skips any of those stages — so the dangerous shortcuts a
busy reviewer might miss in a 200-line Express middleware become
impossible to ship.

It sits on top of the framework you already use (Express, tRPC, more to
come). It doesn't replace your router, your ORM, or your auth layer — it
gives the per-request handler a backbone.

```ts
import { hipExpressHandlerFactory } from 'hipthrusts';

app.get('/things/:id', hipExpressHandlerFactory({
  initPreContext:   (raw)   => ({ user: raw.req.user }),
  sanitizeInputs:   (raw)   => ({ id: String(raw.params.id) }),
  preAuthorize:     (ctx)   => ctx.preContext.user?.role === 'reader',
  attachData:       async (ctx) => ({
    thing: await ThingModel.findById(ctx.inputs.id).exec(),
  }),
  finalAuthorize:   (ctx)   =>
    !!ctx.thing && ctx.thing.ownerId === ctx.preContext.user.id,
  doWork:           (ctx)   => ctx.thing,
  sanitizeResponse: (thing) => ({ id: thing.id, name: thing.name }),
}));
```

Forget any of the five required stages and TypeScript fails the build.
Throw inside any of them and the right HTTP status comes back
automatically (`400` for input errors, `403` for auth, `404` for missing
data, `500` for surprises) — without leaking error details to the caller.

## Why HipThrusTS

Every secure HTTP handler does the same five things, whether you write
them down or not:

1. **Sanitize inputs.** Untrusted data in. Validated, typed shape out.
2. **Pre-authorize.** Cheap, synchronous checks (a JWT role, an API key).
3. **Attach data.** Load the resource the request is about.
4. **Final-authorize.** The ownership/permission check that needs the
   loaded resource.
5. **Sanitize the response.** Strip fields the caller isn't allowed to
   see.

Most frameworks make all five optional. The handler that forgets one
still ships, still compiles, still passes basic tests. The bug appears
in production six months later as a privilege-escalation report.

HipThrusTS makes the five stages **the unit of work**:

- **Mandatory by construction.** `hipExpressHandlerFactory` won't accept
  a config that's missing a required stage — it's a type error.
- **Composable.** Each stage is a pure function. Share the
  "AuthorizeOwner" or "WithUserFromJWT" fragment across every endpoint
  that needs it. `HTPipe` chains them with full type inference, so
  later stages see the data earlier stages produced.
- **Failure-routed.** Throw `Boom.badRequest()` from `sanitizeInputs`,
  `Boom.forbidden()` from auth, `Boom.notFound()` from `attachData` —
  HipThrusTS catches the rest and returns `500 Internal Server Error`
  with no stack-trace leak.
- **Adapter-thin.** Express today, tRPC today, anything else in a
  ~100-line file tomorrow. The lifecycle is framework-agnostic.

## Install

```sh
npm install hipthrusts
# peer-installs depending on what you'll use:
npm install express @hapi/boom
npm install zod          # if you want Zod-based validation helpers
npm install mongoose     # if you want the mongoose helpers
```

## The lifecycle, in detail

Every handler config is a plain object. Five methods are required; three
are optional. Each method receives a `context` that accumulates as the
request progresses, so a later stage sees everything earlier stages
returned.

| Stage              | Required | Async? | Receives                       | Produces                              |
|--------------------|----------|--------|--------------------------------|---------------------------------------|
| `initPreContext`   | no       | sync   | raw request                    | a `preContext` slice                  |
| `extractInputs`    | no       | sync   | adapter-canonical raw inputs   | augmentations to inputs               |
| `sanitizeInputs`   | **yes**  | sync   | unsafe inputs                  | typed, validated `inputs`             |
| `preAuthorize`     | **yes**  | sync   | `{ inputs, preContext }`       | `true` / `false` / a slice to merge   |
| `attachData`       | no       | async  | everything so far              | loaded resources                      |
| `finalAuthorize`   | **yes**  | async  | everything so far              | `true` / `false` / a slice to merge   |
| `doWork`           | **yes**  | async  | everything so far              | unsafe response value                 |
| `sanitizeResponse` | **yes**  | sync   | unsafe response                | safe response sent to caller          |

Authorization stages return `true` to pass, `false` to deny, or an
**object** to pass *and* contribute that object to the context. So
`finalAuthorize` can do its check and produce the resource role at the
same time:

```ts
finalAuthorize: (ctx) =>
  ctx.thing.ownerId === ctx.preContext.user.id
    ? { isOwner: true as const }
    : false,
```

…and `doWork` will see `ctx.isOwner` with full type information.

## Compose, don't repeat yourself

The real payoff shows up the second time you need "load a Thing by ID,
require the caller to own it." Write it once:

```ts
import { HTPipe, AttachData, FinalAuthorize, InitPreContext } from 'hipthrusts';

// Lift the authenticated user out of the raw request once.
export const WithUserFromReq = InitPreContext((raw: { req: { user?: any } }) => ({
  user: raw.req.user,
}));

// Load the addressed Thing and require that the caller owns it.
export const RequireThingOwner = HTPipe(
  AttachData(async (ctx: { inputs: { params: { id: string } } }) => ({
    thing: await ThingModel.findById(ctx.inputs.params.id).exec(),
  })),
  FinalAuthorize((ctx: { thing: any; preContext: { user: { id: string } } }) =>
    ctx.thing && ctx.thing.ownerId === ctx.preContext.user.id
      ? { isOwner: true as const }
      : false,
  ),
);
```

Then use it in every handler that needs it:

```ts
import { hipExpressHandlerFactory, HTPipe, WithInputSlice } from 'hipthrusts';

app.put('/things/:id', hipExpressHandlerFactory(HTPipe(
  WithUserFromReq,                                        // preContext.user
  WithInputSlice('params', (p: any) => ({ id: String(p.id) })),
  WithInputSlice('body',   (b: any) => ({ name: String(b.name) })),
  RequireThingOwner,                                      // shared fragment
  {
    preAuthorize:     (ctx) => ctx.preContext.user?.role === 'editor',
    doWork:           async (ctx) => {
      ctx.thing.name = ctx.inputs.body.name;
      return ctx.thing.save();
    },
    sanitizeResponse: (t) => ({ id: t.id, name: t.name }),
  },
)));
```

`HTPipe` walks each stage left-to-right, threading the context through
and intersecting types so a `doWork` written here knows it can reach for
`ctx.thing`, `ctx.preContext.user`, `ctx.inputs.params.id`, and `ctx.isOwner`.

## Validation helpers

### Zod

```ts
import { z } from 'zod';
import { hipExpressHandlerFactory, htZodFactory, HTPipe } from 'hipthrusts';

const { SanitizeInputsSliceWithZod, SanitizeResponseWithZod } = htZodFactory();

const Params  = z.object({ id: z.string().uuid() });
const Body    = z.object({ name: z.string().min(1).max(80) });
const Resp    = z.object({ id: z.string(), name: z.string() });

app.put('/things/:id', hipExpressHandlerFactory(HTPipe(
  WithUserFromReq,
  SanitizeInputsSliceWithZod('params', Params),
  SanitizeInputsSliceWithZod('body',   Body),
  SanitizeResponseWithZod(Resp),
  RequireThingOwner,
  {
    preAuthorize: () => true,
    doWork: async (ctx) => {
      ctx.thing.name = ctx.inputs.body.name;
      return ctx.thing.save();
    },
  },
)));
```

### Mongoose

```ts
import mongoose from 'mongoose';
import { htMongooseFactory } from 'hipthrusts';

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
import { hipTrpcProcedure } from 'hipthrusts';

export const updateThing = t.procedure
  .input(z.object({ id: z.string(), name: z.string() }))
  .mutation(hipTrpcProcedure({
    initPreContext:   (raw) => ({ user: raw.ctx.user }),
    sanitizeInputs:   (i)   => i,
    preAuthorize:     (ctx) => !!ctx.preContext.user,
    finalAuthorize:   ()    => true,
    doWork:           async (ctx) =>
      ThingModel.findByIdAndUpdate(ctx.inputs.id, { name: ctx.inputs.name }),
    sanitizeResponse: (t)   => ({ id: t.id, name: t.name }),
  }));
```

The lifecycle, the type-checking, the failure routing — all identical to
the Express path. Anything reusable you build (auth fragments, ownership
checks, response shapers) works across both.

## How it differs from other frameworks

Frameworks like Express, Fastify, and Hono give you a single
`(req, res) => …` callback and trust you to lay out the security
concerns inside it. Frameworks like NestJS group endpoints into a
controller *class*, where one method is one endpoint and the instance
is a singleton — so there's no per-request scope shared cleanly across
guards, interceptors, and handlers.

HipThrusTS makes a different trade. Each handler config describes the
lifecycle of **one** endpoint — and the context object passed between
stages is the per-request scope. The five mandatory stages give every
handler the same shape, so a security review of one endpoint teaches
you how to read every other endpoint in the codebase.

It's also intentionally an **add-on**, not a replacement. Keep your
router, your auth middleware, your ORM. Wrap individual handlers with
HipThrusTS where the security shape matters.

## Philosophy

- **Secure by default, not by convention.** The compiler enforces the
  five stages; reviewers don't have to.
- **Reusable, not opaque.** Common patterns (ownership, role checks,
  populate-this-resource) become named fragments you compose. No magic
  decorators, no global state.
- **Stay out of your way.** No DI container, no ambient providers, no
  "framework runtime." A handler is data; the adapter executes it.
- **Lean on what works.** Mongoose is great at schema validation. Zod
  is great at parsing. Express is great at routing. HipThrusTS doesn't
  reimplement any of them.

## Roadmap

- More adapters (Fastify, Hono, Koa)
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
