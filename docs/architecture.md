# HipThrusTS, visually

Five diagrams that explain how HipThrusTS works and why it exists:

1. [The lifecycle](#1-the-lifecycle) — the eight stages, how context
   accumulates, and how flow control moves through them
2. [Failure routing](#2-failure-routing) — how each stage's failures map to
   client-safe responses
3. [Composition with `HTPipe`](#3-composition-with-htpipe) — how fragments
   merge, and how a single request snakes across the whole pipe one
   lifecycle stage at a time
4. [Adapters](#4-adapters) — framework adapters on the outside, schema and
   data-model adapters plugged into individual stages
5. [The strictness guarantee](#5-the-strictness-guarantee) — why an
   unsanitized input slice can never reach your business logic

All diagrams are Mermaid, so GitHub renders them natively and they get
reviewed in the same diff as the code they describe.

## 1. The lifecycle

Every handler is the same eight stages (five required, three optional),
run in a fixed order by `executeHipthrustable`. The context is a plain
object that **accumulates**: each stage receives everything earlier stages
produced, and later stages can consume it with full type inference.

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

## 3. Composition with `HTPipe`

The real payoff is writing a fragment once — "load the Thing, require the
caller to own it" — and reusing it everywhere. `HTPipe` merges fragments
**stage by stage**, not end to end:

```mermaid
flowchart LR
    F1["WithUserFromReq<br/><i>extractAmbient</i>"]
    F2["SanitizeInputsSlices<br/><i>sanitizeInputs</i>"]
    F3["RequireThingOwner<br/><i>loadResources<br/>finalAuthorize</i>"]
    F4["endpoint handler<br/><i>preAuthorize<br/>execute<br/>redactResponse</i>"]

    PIPE(["HTPipe(…)"])
    OUT["<b>one complete handler</b><br/>every stage present,<br/>each stage = its fragments chained left→right,<br/>context types intersected"]

    F1 --> PIPE
    F2 --> PIPE
    F3 --> PIPE
    F4 --> PIPE
    PIPE --> OUT
```

At **runtime**, this means a single request does *not* run fragment 1
start-to-finish, then fragment 2. Instead, each lifecycle stage sweeps
left-to-right across every fragment that declares it — threading the
accumulating context through — and only then does the request move to the
next stage, back at the start of the pipe:

```mermaid
sequenceDiagram
    autonumber
    participant C as core lifecycle
    participant U as WithUserFromReq
    participant S as SanitizeSlices
    participant O as RequireThingOwner
    participant H as endpoint handler

    Note over C,H: extractAmbient
    C->>U: extractAmbient(raw)
    U-->>C: { user } → ctx.ambient

    Note over C,H: sanitizeInputs
    C->>S: sanitizeInputs(unsafe)
    S-->>C: { params, body } → ctx.inputs

    Note over C,H: preAuthorize
    C->>H: preAuthorize(ctx)
    H-->>C: true

    Note over C,H: loadResources — back to the pipe's middle
    C->>O: loadResources(ctx)
    O-->>C: { thing } → ctx.thing

    Note over C,H: finalAuthorize
    C->>O: finalAuthorize(ctx)
    O-->>C: { isOwner: true } → ctx.isOwner

    Note over C,H: execute
    C->>H: execute(ctx)
    H-->>C: unsafe result

    Note over C,H: redactResponse
    C->>H: redactResponse(unsafe, ctx)
    H-->>C: safe response
```

When **two fragments declare the same stage**, they chain within that
stage, left to right, and flow control short-circuits:

```mermaid
flowchart LR
    IN["ctx in"] --> L{"left fragment's<br/>finalAuthorize"}
    L -->|"object / true<br/>(contribution spread into ctx)"| R{"right fragment's<br/>finalAuthorize"}
    L -->|"false"| DENY(["stage denies —<br/>right never runs"])
    R -->|"object / true"| PASS(["stage passes;<br/>both contributions merged"])
    R -->|"false"| DENY
```

(`sanitizeInputs` chains output→input like a classic pipe;
`redactResponse` chains the same way, so redactors stack; `execute` runs
both and keeps the right result; loaders and authorizers merge their
contributions as shown.)

`finishPipe(pipe, handler)` is the ergonomic finish for the dominant
shape — one shared pipe plus one endpoint-specific trailing handler —
with the trailing handler's context types **inferred** from the pipe, so
its callbacks need zero annotations.

## 4. Adapters

The lifecycle is framework-agnostic. Three kinds of adapters plug into
it, and none of them know about each other:

- **Endpoint handler adapters** wrap the whole lifecycle for a framework
  (~100 lines each — anything else is a small PR away).
- **Schema validation adapters** produce `sanitizeInputs` fragments from
  a schema library.
- **Data-model adapters** produce `loadResources` fragments (and
  redaction helpers) from your ORM/ODM.

```mermaid
flowchart LR
    subgraph FW["Endpoint handler adapters"]
        direction TB
        EXP["Express<br/><code>toExpressHandler</code>"]
        TRPC["tRPC<br/><code>toTrpcProcedure</code>"]
        HONO["Hono<br/><code>toHonoHandler</code>"]
        FAST["Fastify<br/><code>toFastifyHandler</code>"]
        NEXT["Next.js App Router<br/><code>toNextHandler</code>"]
    end

    subgraph CORE["Core lifecycle (framework-free)"]
        direction TB
        LC["extractAmbient → extractInputs →<br/>sanitizeInputs → preAuthorize →<br/>loadResources → finalAuthorize →<br/>execute → redactResponse"]
    end

    subgraph PLUG["Stage-fragment adapters"]
        direction TB
        ZOD["<b>Zod</b> (schema validation)<br/>SanitizeInputsWithZod<br/>SanitizeInputsSlicesWithZod<br/>→ sanitizeInputs fragments"]
        MOO["<b>Mongoose</b> (data model)<br/>LoadByIdRequiredTo, FindScoped, …<br/>→ loadResources fragments<br/>json-mask → redaction helpers"]
        USR["<b>Auth helpers</b><br/>roleCheckersOnRoleKey,<br/>assigneeCheckersOnIdKey<br/>→ authorize fragments"]
    end

    EXP -->|"canonical raw inputs<br/>{ params, query, body, headers }"| CORE
    TRPC -->|"single input + ctx"| CORE
    HONO --> CORE
    FAST --> CORE
    NEXT --> CORE

    CORE -->|"safe response /<br/>HipError → status or TRPCError"| FW

    ZOD -.->|"plug into<br/>sanitizeInputs"| CORE
    MOO -.->|"plug into<br/>loadResources"| CORE
    USR -.->|"plug into<br/>pre/finalAuthorize"| CORE
```

The framework adapter owns exactly two jobs: hand the lifecycle a
canonical raw request, and translate the outcome (safe response, or a
`HipError`) into its transport's vocabulary. Everything security-relevant
lives in the framework-free middle — which is why the same shared
fragments work unchanged across Express and tRPC.

## 5. The strictness guarantee

Slice-style sanitizers (`SanitizeInputsSlices`) hand the raw remainder to
each other under a hidden `UNSAFE_SLICES` channel, and core **deletes that
channel** when the sanitize stage completes. Only slices you explicitly
sanitized survive — at runtime *and* in the types (consuming a dropped
slice downstream is a compile error).

```mermaid
flowchart LR
    RAW["raw inputs<br/>{ params, query, body, headers }"]

    subgraph STAGE["sanitizeInputs stage"]
        direction LR
        SP["slice sanitizer<br/>params ✓"]
        SB["slice sanitizer<br/>body ✓"]
    end

    BOUNDARY{{"stage boundary:<br/>UNSAFE_SLICES deleted"}}

    SAFE["ctx.inputs = { params, body }<br/>typed, validated"]
    GONE(["query, headers: gone —<br/>never reach preAuthorize or beyond;<br/>referencing them is a compile error"])

    RAW --> SP
    SP -->|"sanitized: { params }<br/>+ raw remainder via UNSAFE_SLICES"| SB
    SB -->|"sanitized: { params, body }<br/>+ raw remainder"| BOUNDARY
    BOUNDARY --> SAFE
    BOUNDARY -.-> GONE
```

Want a raw slice through anyway? Say so explicitly — `{ query: (q) => q }`
is a visible, greppable decision instead of a silent default.
