# HipThrusTS

**Secure-by-default request handlers for Node.js APIs.**

HipThrusTS gives each endpoint a small, explicit lifecycle: extract trusted
ambient request context, extract untrusted inputs, validate those inputs,
authorize, load resources, do the work, and redact the response. The library
makes the security-relevant stages part of the handler shape instead of a
review convention buried inside a 200-line middleware.

**Who this is for.** Use HipThrusTS when an endpoint has inputs that must be
validated, permissions that must be checked, resources that must be loaded, or
responses that must be redacted. If a route is a one-line public health check,
you probably do not need it there.

**Where this fits in your stack.** HipThrusTS is not a router replacement: keep
Express, Hono, Fastify, Next.js App Router, or tRPC for routing; keep your auth
middleware and ORM; wrap the per-route business handler where a consistent
security lifecycle helps.

```ts
import { defineExpressHandler, toExpressHandler } from 'hipthrusts';

app.get(
  '/things/:id',
  toExpressHandler(
    defineExpressHandler({
      extractAmbient: raw => ({ user: raw.req.user }),
      sanitizeInputs: raw => ({ id: String(raw.params.id) }),
      preAuthorize: ctx => ctx.ambient.user?.role === 'reader',
      loadResources: async ctx => ({
        thing: await ThingModel.findById(ctx.inputs.id).exec(),
      }),
      finalAuthorize: ctx =>
        !!ctx.thing && ctx.thing.ownerId === ctx.ambient.user.id,
      execute: ctx => ctx.thing,
      redactResponse: thing => ({ id: thing.id, name: thing.name }),
      responseMeta: { status: 200 },
    })
  )
);
```

Forget a required stage and TypeScript fails the build. Throw a `HipError`
subclass from a stage and the adapter maps it to its native response shape.
Unexpected failures are transformed into internal errors by the core lifecycle.

## Install

```sh
pnpm add hipthrusts

# Install the peers for the adapters/helpers you use:
pnpm add express @hapi/boom   # Express adapter
pnpm add hono                 # Hono adapter
pnpm add fastify              # Fastify adapter
pnpm add next                 # Next.js App Router adapter
pnpm add zod                  # Zod helpers
pnpm add mongoose             # Mongoose helpers
```

## The lifecycle

Every handler config is a plain object. `sanitizeInputs`, `preAuthorize`,
`finalAuthorize`, `execute`, and `redactResponse` are required. The extraction
and resource-loading stages are optional and default to pass-through/no-op
implementations.

| Stage            | Required |     Async? | Receives                     | Produces                          | Use this for...                                               |
| ---------------- | -------: | ---------: | ---------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `extractAmbient` |       no |       sync | adapter raw request envelope | `ctx.ambient`                     | Trusted framework/app context such as the authenticated user. |
| `extractInputs`  |       no |       sync | adapter canonical raw inputs | unsafe inputs for validation      | Reshaping framework inputs before validation.                 |
| `sanitizeInputs` |  **yes** |       sync | unsafe inputs                | `ctx.inputs`                      | Validation, parsing, coercion, and dropping untrusted fields. |
| `preAuthorize`   |  **yes** |       sync | `{ ambient, inputs }`        | `true`, `false`, or context slice | Cheap checks that do not need loaded resources.               |
| `loadResources`  |       no | async/sync | everything so far            | flat context slice                | Database/API loads needed by auth or work.                    |
| `finalAuthorize` |  **yes** | async/sync | everything so far            | `true`, `false`, or context slice | Ownership and permission checks that need loaded resources.   |
| `execute`        |  **yes** | async/sync | everything so far            | unsafe response value             | The mutation/query/business action.                           |
| `redactResponse` |  **yes** |       sync | unsafe response value        | safe response body                | Strip private fields and shape the public response.           |

Authorization stages pass by returning `true` or any object. Returning an object
also merges that object into the working context. Only `false` (or another falsy
non-object) denies. An empty object `{}` passes and contributes no keys.

```ts
finalAuthorize: (ctx) =>
  ctx.thing.ownerId === ctx.ambient.user.id
    ? { isOwner: true as const }
    : false,
```

## Context model

HipThrusTS keeps boundary data namespaced and working state flat:

```text
raw request
  ├─ extractAmbient ───────────────► ctx.ambient   (trusted app/framework data)
  ├─ extractInputs ─ sanitizeInputs ► ctx.inputs    (validated caller data)
  └─ preAuthorize/loadResources/finalAuthorize ───► ctx.* flat working state
                                      execute ─────► unsafe result
                                      redactResponse► safe response body
```

`ctx.ambient` is for trusted-from-framework data such as `raw.req.user` or data
returned from a Next.js `gatherContext` option. `ctx.inputs` is for caller data
after `sanitizeInputs` has validated it. Outputs from `preAuthorize`,
`loadResources`, and `finalAuthorize` are merged flat into the context so later
stages can read `ctx.thing`, `ctx.isOwner`, or any other named slice.

If multiple stages return the same flat context key, the later stage wins at
runtime. Prefer distinct names unless overriding is intentional.

## Compose, don't repeat yourself

Reusable fragments are just partial handler objects. `HTPipe` composes them
left-to-right and preserves type information for later stages.

```ts
import {
  ExtractAmbient,
  FinalAuthorize,
  HTPipe,
  LoadResources,
} from 'hipthrusts';

export const WithUserFromReq = ExtractAmbient(
  (raw: { req: { user?: { id: string; role: string } } }) => ({
    user: raw.req.user,
  })
);

export const RequireThingOwner = HTPipe(
  LoadResources(async (ctx: { inputs: { params: { id: string } } }) => ({
    thing: await ThingModel.findById(ctx.inputs.params.id).exec(),
  })),
  FinalAuthorize((ctx: { thing: any; ambient: { user?: { id: string } } }) =>
    ctx.thing && ctx.thing.ownerId === ctx.ambient.user?.id
      ? { isOwner: true as const }
      : false
  )
);
```

Then build an endpoint from shared and route-local pieces:

```ts
import { defineExpressHandler, HTPipe, toExpressHandler } from 'hipthrusts';

app.put(
  '/things/:id',
  toExpressHandler(
    defineExpressHandler(
      HTPipe(
        WithUserFromReq,
        {
          sanitizeInputs: unsafe => ({
            params: { id: String((unsafe as any).params.id) },
            body: { name: String((unsafe as any).body.name) },
          }),
        },
        RequireThingOwner,
        {
          preAuthorize: ctx => ctx.ambient.user?.role === 'editor',
          execute: async ctx => {
            ctx.thing.name = ctx.inputs.body.name;
            return ctx.thing.save();
          },
          redactResponse: thing => ({ id: thing.id, name: thing.name }),
          responseMeta: ctx => ({
            status: ctx.isOwner ? 200 : 202,
            headers: { 'x-hipthrusts': 'strong' },
          }),
        }
      )
    )
  )
);
```

PascalCase helpers such as `ExtractAmbient`, `LoadResources`, and `Execute`
produce config slices for `HTPipe`. CamelCase names such as `extractAmbient`,
`loadResources`, and `execute` are the actual lifecycle keys.

The `From` / `To` / `FromTo` helper families are named by data flow:
`SanitizeInputsFrom('params', fn)` reads from one key, `SanitizeInputsTo(fn, 'params')` writes to one key, and `SanitizeInputsFromTo('params', fn, 'params')` does both.

## Routes-file sketch

A typical routes file stays ordinary router code; HipThrusTS owns only the
handler body.

```ts
router.get(
  '/things',
  toExpressHandler(
    defineExpressHandler(
      HTPipe(WithUserFromReq, {
        sanitizeInputs: raw => ({ query: raw.query }),
        preAuthorize: ctx => !!ctx.ambient.user,
        finalAuthorize: () => true,
        execute: ctx => ThingModel.find({ ownerId: ctx.ambient.user.id }),
        redactResponse: things => things.map(t => ({ id: t.id, name: t.name })),
      })
    )
  )
);

router.get(
  '/things/:id',
  toExpressHandler(
    defineExpressHandler(
      HTPipe(
        WithUserFromReq,
        { sanitizeInputs: raw => ({ params: { id: String(raw.params.id) } }) },
        RequireThingOwner,
        {
          preAuthorize: () => true,
          execute: ctx => ctx.thing,
          redactResponse: publicThing,
        }
      )
    )
  )
);

router.put(
  '/things/:id',
  toExpressHandler(
    defineExpressHandler(
      HTPipe(
        WithUserFromReq,
        {
          sanitizeInputs: raw => ({
            params: { id: String(raw.params.id) },
            body: raw.body,
          }),
        },
        RequireThingOwner,
        {
          preAuthorize: ctx => ctx.ambient.user?.role === 'editor',
          execute: updateThing,
          redactResponse: publicThing,
        }
      )
    )
  )
);
```

## Adapters

All HTTP-style adapters expose the same pattern: a `defineXHandler` identity
function for inference and a `toXHandler` adapter for the framework.

### Express

```ts
import { defineExpressHandler, toExpressHandler } from 'hipthrusts';

app.post(
  '/greet/:name',
  toExpressHandler(
    defineExpressHandler({
      sanitizeInputs: raw => ({ name: String(raw.params.name) }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: ctx => ({ greeting: `Hello, ${ctx.inputs.name}!` }),
      redactResponse: result => result,
      responseMeta: { status: 201 },
    })
  )
);
```

Express maps `HipError` values to Boom errors and passes them to `next`, so your
existing Boom-aware error middleware can keep handling failures.

### Hono

```ts
import { Hono } from 'hono';
import { defineHonoHandler, toHonoHandler } from 'hipthrusts';

const app = new Hono();
app.post(
  '/greet/:name',
  toHonoHandler(
    defineHonoHandler({
      sanitizeInputs: raw => ({ name: String(raw.params.name) }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: ctx => ({ greeting: `Hello, ${ctx.inputs.name}!` }),
      redactResponse: result => result,
    })
  )
);
```

### Fastify

```ts
import fastify from 'fastify';
import { defineFastifyHandler, toFastifyHandler } from 'hipthrusts';

const app = fastify();
app.post(
  '/greet/:name',
  toFastifyHandler(
    defineFastifyHandler({
      sanitizeInputs: raw => ({ name: String(raw.params.name) }),
      preAuthorize: () => true,
      finalAuthorize: () => true,
      execute: ctx => ({ greeting: `Hello, ${ctx.inputs.name}!` }),
      redactResponse: result => result,
    })
  )
);
```

### Next.js App Router

```ts
import { defineNextHandler, toNextHandler } from 'hipthrusts';

const handler = toNextHandler(
  defineNextHandler({
    extractAmbient: raw => ({ user: raw.user }),
    sanitizeInputs: raw => ({ name: String(raw.params.name) }),
    preAuthorize: ctx => !!ctx.ambient.user,
    finalAuthorize: () => true,
    execute: ctx => ({ greeting: `Hello, ${ctx.inputs.name}!` }),
    redactResponse: result => result,
  }),
  {
    gatherContext: async req => ({ user: await getUser(req) }),
  }
);

export const POST = handler;
```

### tRPC

`tRPC` already parses procedure input before HipThrusTS sees it. Use
`defineTrpcProcedure` and `toTrpcProcedure`; there is no HTTP `responseMeta` in
this adapter.

```ts
import { defineTrpcProcedure, toTrpcProcedure } from 'hipthrusts';

export const updateThing = t.procedure.input(UpdateThingInput).mutation(
  toTrpcProcedure(
    defineTrpcProcedure({
      extractAmbient: raw => ({ user: raw.ctx.user }),
      sanitizeInputs: input => input,
      preAuthorize: ctx => !!ctx.ambient.user,
      loadResources: async ctx => ({
        thing: await ThingModel.findById(ctx.inputs.id).exec(),
      }),
      finalAuthorize: ctx =>
        !!ctx.thing && ctx.thing.ownerId === ctx.ambient.user.id,
      execute: async ctx => {
        ctx.thing.name = ctx.inputs.name;
        return ctx.thing.save();
      },
      redactResponse: thing => ({ id: thing.id, name: thing.name }),
    })
  )
);
```

## Response metadata and redirects

Core execution returns a safe response body and final context. HTTP adapters own
transport metadata through `responseMeta`, either static or computed from the
final context.

```ts
responseMeta: { status: 201, headers: { Location: `/things/${id}` } }

responseMeta: (ctx) => ({
  status: ctx.created ? 201 : 200,
  headers: { 'x-resource-id': ctx.thing.id },
})
```

Throw `new HipRedirect('/login', 302)` from a stage to ask HTTP-style adapters
to redirect. Non-HTTP adapters should treat redirects as application-specific
control flow rather than response metadata.

## Errors

The core is transport-agnostic and throws semantic errors from `src/errors`:

| Error             | Meaning                              | HTTP-style status |
| ----------------- | ------------------------------------ | ----------------: |
| `HipBadInputs`    | input validation/sanitization failed |               422 |
| `HipUnauthorized` | no authenticated principal           |               401 |
| `HipForbidden`    | authenticated but denied             |               403 |
| `HipNotFound`     | required resource missing            |               404 |
| `HipConflict`     | state conflict                       |               409 |
| `HipInternal`     | unexpected internal failure          |               500 |

Hono, Fastify, and Next.js return JSON `{ error: message }` with those statuses.
Express translates them to Boom. The core transforms unexpected stage failures
to the appropriate semantic error for that stage.

## Validation helpers

### Zod

Zod support is available through `htZodFactory()`.

```ts
import { z } from 'zod';
import {
  defineExpressHandler,
  htZodFactory,
  HTPipe,
  toExpressHandler,
} from 'hipthrusts';

const { SanitizeInputsSliceWithZod, RedactResponseWithZod } = htZodFactory();

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({
  name: z
    .string()
    .min(1)
    .max(80),
});
const Response = z.object({ id: z.string(), name: z.string() });

app.put(
  '/things/:id',
  toExpressHandler(
    defineExpressHandler(
      HTPipe(
        SanitizeInputsSliceWithZod('params', Params),
        SanitizeInputsSliceWithZod('body', Body),
        RedactResponseWithZod(Response),
        {
          preAuthorize: () => true,
          loadResources: async ctx => ({
            thing: await ThingModel.findById(ctx.inputs.params.id).exec(),
          }),
          finalAuthorize: () => true,
          execute: async ctx => {
            ctx.thing.name = ctx.inputs.body.name;
            return ctx.thing.save();
          },
        }
      )
    )
  )
);
```

### Mongoose

```ts
import mongoose from 'mongoose';
import { htMongooseFactory } from 'hipthrusts';

const {
  findByIdRequired, // throws HipNotFound if missing
  PojoToDocument, // builds a mongoose doc from a context key
  UpdateDocumentFromTo, // patches a doc with ctx.inputs.body
  SaveOnDocumentFrom, // .save() with HipBadInputs on validation failure
  SanitizeInputsSliceWithMongoose,
} = htMongooseFactory(mongoose);
```

## No magic: the longhand shape

You do not have to use `HTPipe`, helper factories, or shared fragments. A handler
is just an object literal with lifecycle methods.

```ts
const createThing = defineExpressHandler({
  extractAmbient(raw) {
    return { user: raw.req.user };
  },
  extractInputs(raw) {
    return { params: raw.params, body: raw.body };
  },
  sanitizeInputs(unsafe) {
    return {
      params: { parentId: String(unsafe.params.parentId) },
      body: { name: String(unsafe.body.name) },
    };
  },
  preAuthorize(ctx) {
    return ctx.ambient.user?.role === 'editor';
  },
  async loadResources(ctx) {
    return { parent: await ParentModel.findById(ctx.inputs.params.parentId) };
  },
  finalAuthorize(ctx) {
    return !!ctx.parent && ctx.parent.ownerId === ctx.ambient.user.id;
  },
  async execute(ctx) {
    return ThingModel.create({
      parentId: ctx.parent.id,
      name: ctx.inputs.body.name,
    });
  },
  redactResponse(thing) {
    return { id: thing.id, name: thing.name };
  },
  responseMeta: { status: 201 },
});
```

## FAQ

- **Do I need five functions per endpoint?** For routes you wrap with
  HipThrusTS, yes: the required stages are the point. Trivial routes can stay as
  ordinary framework handlers.
- **What if my route is not CRUD?** The lifecycle is not CRUD-specific. Use
  `execute` for any query, command, RPC action, webhook, or background-triggered
  operation.
- **Can I share context between stages?** Yes. Return an object from
  `preAuthorize`, `loadResources`, or `finalAuthorize`; later stages read those
  keys directly on `ctx`.
- **How is `ctx.ambient` different from `ctx.inputs`?** `ambient` is trusted
  request/app context extracted from the framework envelope. `inputs` is caller
  data after validation. Do not put unvalidated caller data in `ambient`.
- **Can a handler skip authorization?** It must be explicit. Use
  `preAuthorize: () => true` and `finalAuthorize: () => true` for public routes.
  The `NoopPreAuth()` and `NoopFinalAuth()` helpers do the same and should be
  used deliberately.
- **Do helpers hide framework behavior?** No. Helpers produce ordinary config
  slices. Adapters are thin wrappers that translate between the framework and the
  lifecycle.
- **What if validation uses something other than Zod?** `sanitizeInputs` is just
  a function from unknown/unsafe data to safe data. Use any parser or hand-written
  checks you prefer.

## Philosophy

- **Secure by default, not by convention.** The compiler enforces the required
  lifecycle stages.
- **Reusable, not opaque.** Common auth, loading, and response-shaping patterns
  become named fragments you compose.
- **Transport-agnostic core.** HTTP status, headers, Boom, and framework response
  objects live in adapters, not in `executeHipthrustable`.
- **No global runtime.** A handler is data; the selected adapter executes it.

## Roadmap

- More adapter polish and examples
- More ODM/database integrations
- A higher-level resource recipe layer for common CRUD shapes
- More type-level smoke tests for documentation examples

PRs welcome.

## License

MIT.

## About the name

A hip thrust is an exercise — invented by Dr. Bret Contreras — that strengthens
the glutes. This library strengthens your back end. The pun was approved by Dr.
Contreras himself; if fitness is your thing, check out [his work](https://bretcontreras.com/).
