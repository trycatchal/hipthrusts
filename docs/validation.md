# Zod validation helpers

*Part of the [HipThrusTS docs](./README.md) · [← back to the overview](../README.md)*


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
[Errors](./errors.md)).

For partial-update endpoints, pass `Body.partial()` as the slice schema.

## Codec-style wire schemas

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

## Switch-style redaction & sanitization

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

## Deriving input schemas from document schemas

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

