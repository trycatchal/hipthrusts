# Mongoose helpers & data loading

*Part of the [HipThrusTS docs](./README.md) · [← back to the overview](../README.md)*


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

## Everyday loaders & ctxRef

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

> **Building loaders for another backend?** The `ctxRef` marker primitives
> are backend-neutral and also live at their own subpath,
> `hipthrusts/ctx-ref` — `ctxRef`, `isCtxRef` (the runtime guard),
> `CtxRef` / `CtxRefReq`, and `SpecReq` (derives a spec's deps-met
> requirement). Import from there to emit and recognize the *same* markers
> the mongoose loaders use — the marker is keyed by a shared
> `Symbol.for` registry — without depending on the mongoose entrypoint.
> `hipthrusts/mongoose` re-exports `ctxRef` / `CtxRef` / `CtxRefReq` for
> backward compatibility.


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

