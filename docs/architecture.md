# HipThrusTS, visually

Six views that explain how HipThrusTS works and why it exists:

1. [The lifecycle](#1-the-lifecycle) — the eight stages and how flow
   control moves through them
2. [Failure routing](#2-failure-routing) — how each stage's failures map to
   client-safe responses
3. [From raw request to initial context](#3-from-raw-request-to-initial-context)
   — the trusted and untrusted halves of a request, and why unsanitized
   slices can't survive
4. [The context only grows](#4-the-context-only-grows) — how every stage
   layers its contribution onto what came before
5. [Composition with `HTPipe`](#5-composition-with-htpipe) — one request
   sweeping the whole pipe stage by stage
6. [Adapters](#6-adapters) — thin edges around a framework-free middle

Simple flows are Mermaid (GitHub renders it natively, and it's reviewed in
the same diff as the code it describes). The spatial ones — the growing
context stack, the pipe sweep, the adapter surface — are hand-drawn SVGs
in [`img/`](./img), also plain text in the diff, drawn with theme-neutral
colors so they read correctly in both GitHub light and dark mode.

## 1. The lifecycle

Every handler is the same eight stages (five required, three optional),
run in a fixed order by `executeHipthrustable`.

Authorization stages return `true` to pass, `false` to deny, or an
**object** to pass *and* contribute that object's keys to the context.

```mermaid
flowchart TD
    RAW(["Raw request<br/>(framework-specific)"])

    EA["<b>extractAmbient</b> · optional, sync<br/>lift trusted ambient: auth principal, request ID"]
    EI["<b>extractInputs</b> · optional, sync<br/>adapter-specific input shaping"]
    SI["<b>sanitizeInputs</b> · required, sync<br/>untrusted in → validated, typed out"]
    PA{"<b>preAuthorize</b> · required, sync<br/>cheap check before touching the DB"}
    LR["<b>loadResources</b> · optional, async<br/>fetch the resource the request is about"]
    FA{"<b>finalAuthorize</b> · required, async<br/>ownership check with the resource in hand"}
    EX["<b>execute</b> · required, async<br/>the actual work"]
    RR["<b>redactResponse</b> · required, sync<br/>strip fields the caller may not see"]

    RESP(["Safe response"])
    DENY(["HipForbidden → 403"])

    RAW --> EA
    EA -->|"ctx.ambient = { user, … }"| EI
    EI -->|"unsafe inputs"| SI
    SI -->|"ctx.inputs = validated shape"| PA
    PA -->|"true / object → spread into ctx"| LR
    PA -->|"false"| DENY
    LR -->|"ctx.thing = loaded doc"| FA
    FA -->|"true / object → spread into ctx<br/>e.g. { isOwner: true }"| EX
    FA -->|"false"| DENY
    EX -->|"unsafe response"| RR
    RR --> RESP
```

The five required stages are **mandatory by construction**: an adapter
won't accept a config that's missing one — it's a compile error, not a
code-review catch.

## 2. Failure routing

Flow control on the unhappy path is just as fixed as the happy path.
Throw a `HipError` from any stage and the adapter translates it to the
right transport response (HTTP status, or `TRPCError` code). Anything
*unexpected* thrown from a stage is routed by **which stage it escaped
from** — so a dropped DB connection can never masquerade as "not found,"
and no stack trace ever leaks to the caller.

```mermaid
flowchart LR
    subgraph STAGES["Stage that threw"]
        direction TB
        S1["extractAmbient / extractInputs / sanitizeInputs"]
        S2["preAuthorize / finalAuthorize<br/>returned false"]
        S3["any stage:<br/>threw a HipError deliberately"]
        S4["preAuthorize / loadResources /<br/>finalAuthorize / execute / redactResponse:<br/>unknown throw (bug, outage)"]
    end

    subgraph OUT["What the client sees"]
        direction TB
        E422["HipBadInputs → 422<br/>(these stages exist to reject bad input;<br/>original error chained as cause)"]
        E403["HipForbidden → 403"]
        EMAP["That error's own status:<br/>HipNotFound → 404, HipConflict → 409,<br/>HipUnauthorized → 401, …"]
        E500["HipInternal → 500<br/>one scrubbed message,<br/>cause chained for logging"]
    end

    S1 --> E422
    S2 --> E403
    S3 --> EMAP
    S4 --> E500
```

## 3. From raw request to initial context

A request object carries two very different kinds of data, and the first
two lifecycle stages exist to keep them apart. Things the **caller
controls** (params, body, query, headers) are untrusted and must pass
through `sanitizeInputs`. Things **your own middleware produced** before
the handler ran (`req.user` from your auth layer, a request ID, a locale)
are trusted, and `extractAmbient` lifts them directly.

```mermaid
flowchart TD
    REQ["request object"]

    subgraph UT["untrusted — the caller controls this"]
        P["params"]
        B["body"]
        Q["query · headers · …"]
    end
    MW["trusted — produced by your own<br/>prior middleware: req.user, request ID"]

    SI["<b>sanitizeInputs</b><br/>validate every slice you want to keep"]
    EA["<b>extractAmbient</b><br/>lift what you already trust"]

    DROP(["slices you didn't sanitize are deleted<br/>at the stage boundary — consuming one<br/>downstream is a compile error"])
    CTX["<b>initial context</b><br/>ctx.ambient — trusted<br/>ctx.inputs — validated"]

    REQ --> UT
    REQ --> MW
    P -->|"validated"| SI
    B -->|"validated"| SI
    Q -.->|"not sanitized"| DROP
    MW --> EA
    SI -->|"ctx.inputs"| CTX
    EA -->|"ctx.ambient"| CTX
```

That drop is the **strictness guarantee**: slice sanitizers pass the raw
remainder to each other on a hidden `UNSAFE_SLICES` channel, and core
deletes that channel the moment the stage completes — at runtime *and* in
the types. Want a raw slice through anyway? Say so explicitly
(`{ query: (q) => q }`) — a visible, greppable decision instead of a
silent default.

## 4. The context only grows

From the initial context onward, every stage receives everything earlier
stages produced and layers on its own contribution. `execute` written at
the end of a long chain can reach `ctx.ambient.user`,
`ctx.inputs.params.id`, `ctx.thing`, and `ctx.isOwner` — with full type
inference.

![Each stage reads the whole accumulated context and adds one layer to it](./img/context-accumulation.svg)

## 5. Composition with `HTPipe`

`HTPipe(...)` merges reusable fragments — "lift the user," "sanitize
these slices," "load the Thing and require ownership" — into one complete
handler. The merge is **stage by stage, not end to end**: at runtime, each
lifecycle stage sweeps left-to-right across every input that declares it,
threading the accumulating context through; only then does the request
wrap back to the start of the pipe for the next stage.

![A single request sweeps the whole pipe once per lifecycle stage, wrapping back to the start of the pipe between stages](./img/htpipe-composition.svg)

Per-stage chaining rules, for the curious: `sanitizeInputs` and
`redactResponse` chain output→input (so redactors stack); loaders and
authorizers merge their object contributions (right wins on a key clash);
`execute` runs both and keeps the right result. And
`finishPipe(pipe, handler)` finishes the dominant authoring shape — one
shared pipe plus one endpoint-specific trailing handler — with the
trailing handler's context types inferred from the pipe, so its callbacks
need zero annotations.

## 6. Adapters

The middle is framework-free; only the edges know what framework you're
on. **Endpoint adapters** (~100 lines each) canonicalize the raw request
on the way in and translate the outcome on the way out. **Stage
factories** — Zod for validation, Mongoose for loading and redaction,
role/assignee helpers for authorization — emit fragments for one specific
stage. The same handler object runs unchanged under any of them.

![Endpoint adapters wrap the handler's edges; stage factories plug fragments into single stages](./img/adapters.svg)
