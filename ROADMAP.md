# Roadmap

## 1.x hardening

1.0.0 shipped the semver commitment: the exported names that survived to
1.0 are frozen, and the README now states the policy. These items carried
over from the road-to-1.0 list — all internal or additive, so none of them
need a major release:

- [ ] **Brand-based `isHipError`** — today the check is `instanceof`-based.
      Within one module format that's safe (the build keeps a single class
      copy per format), but an app that mixes `require('hipthrusts')` and
      `import 'hipthrusts'` gets two class identities (the classic dual-package
      hazard). A brand/symbol check would make error translation immune.
- [ ] **Type-checked linting** — graduate ESLint to
      `recommended-type-checked` and reduce `any` in adapter internals.
- [ ] **Coverage thresholds** — now that coverage is measured, set floors and
      enforce them in CI.
- [ ] **Type-level test expansion** — the TYPESCRIPT-KOSHERNESS checks from
      the old TODO: `ModelWithFindById` instance-member typing and
      `fromWrappedInstanceMethod` in/out inference guarantees.

## 2.0 candidates

Parking lot surfaced by production use. None is required for 1.x; each is
recorded here so it isn't lost. The first two are additive and could land
in a 1.x minor if a concrete use case arrives; the rest are genuinely 2.0
(behavioral or vocabulary changes).

- [ ] **Lazy request-body parsing in the HTTP adapters** (additive,
      possibly 1.x). Adapters currently `await req.text()` + `JSON.parse`
      *before* the lifecycle starts, so a malformed body yields a `422`
      ahead of everything — including the auth gate (see the README "auth
      gate" section), which can reject an anonymous caller before their
      inputs are validated but not before their body is read. Deferring the
      read/parse until the first stage that actually consumes `raw.body`
      (baseline `extractInputs`) would let the gate reject a caller before
      any byte of their body is processed. A per-adapter change (lazy getter
      / thunk on `raw.body`). Complications: adapters that must read the body
      regardless (e.g. HMAC-signed webhooks) and preserving
      `allowMalformedBody` semantics.
- [ ] **Export `SpecReq` and `isCtxRef` from `hipthrusts/mongoose`**
      (additive, possibly 1.x). Alternative-backend loader flavors that want
      to reuse the upstream `ctxRef` markers must currently restate the
      module-private `SpecReq` mapped type and the `isCtxRef` guard — a drift
      surface. Exporting both (types-only for `SpecReq`) lets those loaders
      stay byte-compatible without restatement.
- [ ] **Optional `gateAmbient` stage / alias** (2.0, cosmetic). The auth-gate
      pattern bends the "extract" vocabulary (an extraction that throws).
      A first-class `gateAmbient` alias would name the intent explicitly while
      `extractAmbient` keeps its lift-only contract. Zero functional value —
      naming only; the documented pattern already works. Alternative: never
      bother.
- [ ] **Re-typing nested ctx paths via contributions** (2.0, speculative,
      type-machinery-heavy). Auth pipelines lift `ambient.principal` to a
      top-level `ctx.principal` because that lift is the narrowing event
      (`Principal | null` → `Principal`): contributions merge at the ctx top
      level and cannot re-type an existing nested key. If a contribution could
      declare "after this stage `ambient.principal` is non-null", the lift
      convention would become purely stylistic. Park until a concrete use case
      justifies the type machinery.

## Exploratory

- More adapters: Koa, others by request.
- More ODM integrations with injection-safe finders: Prisma, Drizzle,
  TypeORM; more mongoose wrappers beyond `findById`/`findOne`.
- A higher-level "resource recipe" layer deriving a full CRUD handler set
  from `{ resource, principals, operations }`.
- Meta-handlers: try several handlers, first one to pass both authorization
  stages wins (for routes like `/byOwner/:id` vs `/byAnyone/:id`).
- Starter template / `create-` scaffold to show it off.
- Abstract security principals beyond the "user" special case
  (`hipthrusts/user` stays as the ergonomic default).
- Optional query-param and header sanitization slices.
- Response-type support per handler (json, raw, redirect) via
  `responseMeta` extensions.
- A logo. ;)

Done items that used to live in TODO.md — pipeable composition (`HTPipe`),
framework-configurable adapters (Express/Fastify/Hono/Next/tRPC split), the
mongoose split (`htMongooseFactory`), and the test suite — are recorded in
[CHANGELOG.md](./CHANGELOG.md).
