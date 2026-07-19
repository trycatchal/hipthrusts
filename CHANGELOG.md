# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(before 1.0, minor releases could contain breaking changes).

## [Unreleased]

### Documentation

- README rewritten as a visual-first overview (~230 lines, down from
  ~1100): the new lifecycle diagram (`docs/img/lifecycle.svg`, hand-drawn
  SVG so it renders on npm too), context accumulation, and `HTPipe`
  composition now appear inline instead of behind a link. The deep
  reference material moved to six topic pages under `docs/` — lifecycle,
  composition, errors, adapters, validation (zod), mongoose — indexed from
  `docs/README.md`. The diagrams from `docs/architecture.md` were
  redistributed to sit next to the prose they illustrate (that file is now
  a pointer stub), and the failure-routing diagram was corrected for
  1.1.0's `extractAmbient` unknown-throw fix (422 row → 500 row).
- typedoc: the `hipthrusts/ctx-ref` subpath added in 1.1.0 is now an
  entry point, so its exports appear in the generated API reference.

## [1.1.0] - 2026-07-19

### Added

- New backend-neutral subpath `hipthrusts/ctx-ref`: the canonical home for
  the `ctxRef` marker primitives — `ctxRef`, `isCtxRef` (runtime guard),
  `CtxRef` / `CtxRefReq`, and `SpecReq` (derives a filter spec's combined
  deps-met context requirement). Alternative-backend loader flavors (a
  non-mongoose ODM, a hand-rolled loader) can now emit and recognize the
  *same* markers the built-in mongoose loaders use — the marker is keyed by
  the shared `Symbol.for('hipthrusts.ctxRef')` registry — without importing
  the mongoose entrypoint or restating any private machinery. `isCtxRef` and
  `SpecReq` are newly exported here; `ctxRef` / `CtxRef` / `CtxRefReq`
  (previously reachable only via `hipthrusts/mongoose`) now live here too.

### Changed

- `hipthrusts/mongoose` re-exports `ctxRef` / `CtxRef` / `CtxRefReq` from the
  new `hipthrusts/ctx-ref` subpath, so imports of those names from
  `hipthrusts/mongoose` continue to work unchanged (backward compatible).

### Deprecated

- Importing `ctxRef` / `CtxRef` / `CtxRefReq` from `hipthrusts/mongoose` is
  deprecated (the re-exports carry `@deprecated` JSDoc, so editors flag them
  with a "import from `hipthrusts/ctx-ref`" hint). Import them from the
  backend-neutral `hipthrusts/ctx-ref` subpath instead. The re-exports remain
  functional and will be removed only in a future major.

### Fixed

- `extractAmbient` now routes an unknown (non-`HipError`) throw to `500`
  (`HipInternal`) instead of `422` (`HipBadInputs`). As the first lifecycle
  stage, `extractAmbient` never sees validated input and only lifts trusted
  ambient off the raw request, so a crash there is an app/infra bug, not a
  client-attributable input problem — this aligns it with `preAuthorize` /
  `loadResources` (the same misclassification family as the 0.12.0 "unknown
  load errors → 404" correction). Deliberate statuses are unaffected: a
  `HipError` (e.g. `HipUnauthorized`) thrown from `extractAmbient` still
  passes through unwrapped, which is what powers the auth-before-validation
  gate now documented in the README.
- mongoose sanitizers and redactor: every shape-affecting `toObject` option
  is now explicitly pinned to mongoose's defaults, so ambient config
  (`mongoose.set('toObject', ...)` or schema-level options) can no longer
  alter the shape of sanitized inputs or redacted responses ([#110](https://github.com/trycatchal/hipthrusts/issues/110)).

### Documentation

- New README section, "Rejecting a caller before validating their inputs
  (the auth gate)": documents that composing an `extractAmbient` fragment
  which throws `HipUnauthorized` yields per-endpoint auth-before-validation
  (401 precedes 422) with no lifecycle reorder or framework flag — the
  default validate-first order plus this opt-in gate cover both sides of the
  422-vs-401 debate. Also states what the gate does not preempt (the
  adapters' body parse and `gatherContext` run before any stage).

### Tests

- Runtime regression suite locking the composed-authorizer context merge
  (left-returned context preserved through `HTPipe`'d `preAuthorize`/
  `finalAuthorize`, short-circuiting, arity edges, and an end-to-end adapter
  pass) ([#111](https://github.com/trycatchal/hipthrusts/issues/111), originally #37).
- Lifecycle unknown-error routing: `extractAmbient` unknown throw → 500
  (chaining the original as `cause`), `HipUnauthorized` from `extractAmbient`
  passes through as-is, and `extractInputs`/`sanitizeInputs` unknown throws
  stay 422.

## [1.0.0] - 2026-07-17

First stable release. No API changes since 0.13.0 — this release is the
semver commitment: the public API surface shipped in 0.13.0 is frozen, and
breaking changes from here on land only in major releases.

### Changed

- Default branch renamed from `master` to `main`; CI/docs workflows,
  contribution docs, and changelog compare links updated to match.
- SECURITY.md supported-versions policy updated for 1.x.

### Security

- Dev-dependency refresh clearing all open Dependabot advisories (dev/CI
  only — the published package ships no runtime dependencies, so none of
  these ever reached consumers). Refreshed `hono`, `fastify`, `mongoose`,
  `next`, `tsx`, `vitest`, `@hono/node-server`, and `@types/node` within
  range, and added `pnpm.overrides` pinning the transitive `vite` (≥8.0.16)
  and `postcss` (≥8.5.10) up out of their advisories. `prettier` is pinned
  to an exact version to keep formatting stable across environments.

## [0.13.0] - 2026-07-17

_Dogfooding feedback round 2: composability/DX gaps surfaced by three more
rounds of real-world use on 0.12.0. No correctness fixes needed — 0.12.0 held
up._

### Added

- `finishPipe(pipe, handler)` (core): compose a shared partial pipeline with
  ONE endpoint-specific trailing handler whose stage callbacks get their
  context parameter types **inferred from the pipe** — zero hand-written
  annotations, phantom context keys are compile errors, and pipe-internal
  deps-met requirements (e.g. the scoped finders' `queryScope`) still surface
  as `HipDepNotMet` at the adapter boundary. Runtime is literally
  `HTPipe(pipe, handler)`. The trailing handler is limited to
  `preAuthorize`/`loadResources`/`finalAuthorize`/`execute`/`redactResponse`/
  `responseMeta` (author extraction/sanitization in the pipe). Also exports
  the `PipeContext<TPipe>` utility behind it.
- Everyday mongoose loader fragments (module-level in `hipthrusts/mongoose`):
  `LoadManyTo` (find), `LoadOneTo` (findOne), `LoadByIdRequiredTo` (findById +
  `.lean()`, throws `HipNotFound` when missing), `LoadDocByIdRequiredTo`
  (findById hydrated, for `.set()`/`.save()` update flows). Lean reads type as
  `TRaw & { _id: Types.ObjectId }`; doc types are inferred from mongoose's own
  `Model<TRaw>` via type-only imports.
- `ctxRef('dot.path')` filter/id specs for the loaders: the fragment's context
  REQUIREMENT is derived from the path string via template-literal types, so
  deps-met still enforces that an earlier stage provides e.g.
  `inputs.body.user` — with no hand-written context annotations. ctxRef-
  resolved values are `$eq`-wrapped (and `undefined` entries pruned) so
  user-influenced values can't smuggle query operators; literal spec values
  pass through verbatim (the operator-filter escape hatch); a selector-
  function overload remains for computed filters.
- Scoped finder query options: `FindScoped(Model, extraFilter?, { sort,
  limit, skip, projection, lean, docsKey })` and `LoadScopedTo(Model, key,
  extraFilter?, options?)`, so real list endpoints keep pagination and
  ordering. `queryScope` stays type-required. PascalCase names are now
  canonical (matching every other fragment factory); the camelCase
  `findScoped`/`loadScopedTo` factory entries remain as aliases, and a bare
  string third argument to `FindScoped` is still accepted as the docs key.
- Switch composers (core): `RedactResponseSwitch(ctxKeyPath, cases)` picks
  ONE simple redact fragment by the value at a context dot path ("a key of a
  key": `'principal.role'`) — the composed fragment type-REQUIRES that
  context key via deps-met, and cases are ordinary fragments
  (`RedactResponse`, `RedactResponseWithZod`, ...), so contextual redaction
  is a layer over the basic redactors, not a separate mechanism.
  `SanitizeInputsSwitch(inputsKeyPath, cases)` is the sanitize-stage twin;
  its discriminator lives in the unsafe inputs (sanitization runs before any
  context exists) and an unmatched key rejects with `HipBadInputs`.
- Adapter preset factories: `makeExpressHandlerFactory`,
  `makeHonoHandlerFactory`, `makeFastifyHandlerFactory`,
  `makeNextHandlerFactory` — bake shared adapter options (e.g.
  `gatherContext`, `onError`) into a reusable converter; per-call options
  merge over the defaults.

### Changed

- Errors thrown from `afterResponse` are no longer silently swallowed: they
  are routed to `onError` with `info.phase === 'afterResponse'` (all HTTP
  adapters), so a failed audit write is observable. They still can never
  affect the already-sent response.
- `json-mask` is now loaded lazily (only `dtoSchemaObj` uses it), so
  consumers using only the finders/loaders no longer need it installed.

### Docs

- README: partial pipelines as the reuse unit; `finishPipe`; everyday
  loaders + `ctxRef`; codec-style zod wire schemas; switch-style
  redaction/sanitization; deriving update schemas from doc schemas (the
  `.default()`-under-`.partial()` trap); adapter preset factories;
  `defineXHandler` vs `finishPipe` division of labor.

## [0.12.0]

_The entries below fold the previously-unreleased modernization work and the
dogfooding-feedback fixes into the 0.12.0 release._

### Added (dogfooding feedback round)

- Structured error bodies: HTTP adapters now respond with
  `{ error, issues?, detail? }`. A `ZodError` detail is projected to
  `issues: [{ path, message }]` (paths + messages only — never received input
  values); other `detail` is serialized only when the error was constructed
  with the new `{ expose: true }` opt-in (`HipErrorOptions`); `HipInternal`
  exposes nothing beyond its message. (`hipErrorToBody` in
  `hipthrusts/errors`.)
- `onError(error, { raw })` adapter option (all HTTP adapters): observability
  hook called with every error the adapter converts to an error response.
  Unknown failures carry the original error as `Error.cause`.
- `afterResponse(context)` adapter option (all HTTP adapters): post-response
  side effects now receive the final lifecycle context (inputs, ambient,
  loaded resources, response).
- `redactResponse(unsafe, context?)`: redactors may take the final context as
  a second argument (e.g. role-dependent field redaction); a two-parameter
  redactor's context keys participate in the deps-met type checking.
- `HTPipe` typed overloads extended from 4 to 8 fragments.
- `HTPipe` passes non-stage keys (e.g. `responseMeta`) through composition
  with right-wins semantics instead of silently dropping them.
- `SanitizeInputsSlices({ params: fn, ... })` core helper plus
  `SanitizeInputsSlicesWithZod` / `SanitizeInputsSlicesWithMongoose`:
  per-slice sanitization with every slice key named in the return type.
- Tenant-scoping helpers in `htMongooseFactory`: `findScoped(Model,
  extraFilter?)` and `loadScopedTo(Model, key, extraFilter?)` compose
  `ctx.queryScope` into the query and type-REQUIRE it, making a missing
  tenant filter a compile error.
- Readable deps-met diagnostics: an unmet context dependency now surfaces as
  `HipDepNotMet<'stage', 'key'>` in the compiler error instead of collapsing
  to `never`; `any`-typed context keys and union stage returns are tolerated.
- Type-level test suite (`vitest --typecheck`, `test/*.test-d.ts`).

### Removed (dogfooding feedback round)

- **BREAKING:** `WithInputSlice`, `SanitizeInputsSliceWithZod`, and
  `SanitizeInputsSliceWithMongoose` are gone — replaced by the map-based
  plural forms (`SanitizeInputsSlices({ params: fn })`,
  `SanitizeInputsSlicesWithZod({ params: Schema })`,
  `SanitizeInputsSlicesWithMongoose({ params: Factory })`), which handle the
  single-slice case with the same call shape and remove the
  one-letter-apart Slice/Slices API trap. `SanitizeInputsSlicesWithZod` no
  longer takes a `partial` option — pass `Schema.partial()` yourself.

- **BREAKING:** the express adapter no longer depends on `@hapi/boom`. It now
  responds to errors directly (status + `{ error, issues?, detail? }`) like
  the other HTTP adapters. Apps with their own express error middleware can
  pass `{ delegateErrors: true }` to `toExpressHandler` to receive the raw
  `HipError` via `next()` and translate it with `hipErrorToStatus` /
  `hipErrorToBody`.

### Changed (dogfooding feedback round)

- **BREAKING:** unknown (non-`HipError`) exceptions from `preAuthorize`,
  `loadResources`, and `finalAuthorize` now become `HipInternal` (500) with
  the original error chained as `Error.cause` — previously they surfaced as
  403/404/403 respectively, so infra failures masqueraded as authorization
  or not-found results. 404 remains the deliberate signal: throw
  `HipNotFound` (e.g. via `findByIdRequired`). Input stages keep mapping
  unknown throws to `HipBadInputs` (422), now also with `cause`.
- **BREAKING:** the unexpected-failure scrub message is now uniformly
  `"Internal server error"` (exported as `INTERNAL_ERROR_MESSAGE`); core
  previously used `"Uncaught exception"`.
- **BREAKING:** `afterResponse` (Next adapter) now fires only after a
  successful lifecycle (previously it was scheduled before the lifecycle and
  fired even for failed requests) and receives the final context.
- **BREAKING:** the Next.js and Hono adapters respond
  `422 { "error": "Malformed JSON body" }` to non-empty bodies that fail to
  parse as JSON instead of silently coercing them to `{}`; opt out with
  `allowMalformedBody: true`. Empty bodies still coerce to `{}`.
- **BREAKING (strictness guarantee):** only explicitly-sanitized input
  slices survive the sanitize stage. Chained slice sanitizers pass the raw
  remainder to each other under the exported `UNSAFE_SLICES` symbol, and
  core deletes that channel after the stage — an unsanitized slice never
  reaches later stages, at runtime or in the types (consuming one downstream
  is now a compile error). Pass a raw slice through explicitly with a no-op:
  `SanitizeInputsSlices({ query: (q) => q })`. Whole-object sanitizers
  (tRPC-style) are unaffected.
- **BREAKING:** `findScoped` is now a two-stage fragment: the scoped
  `Model.find` runs on the LOAD stage (rows in context for finalAuthorize /
  redactResponse / downstream execute stages, under `scopedDocs` or a custom
  third-argument key) with a trivial execute returning them.
- `PipedSanitizeInputs` merges the left fragment's named keys through
  slice-style right fragments, so piping two `SanitizeInputsSlices`
  fragments keeps both slices visible to later stages (the README's own
  multi-slice example now typechecks).

### Added

- Hono, Fastify, and Next.js (App Router) adapters alongside the existing
  Express and tRPC adapters ([#101](https://github.com/trycatchal/hipthrusts/pull/101)).
- `HipError` hierarchy (`HipBadInputs`, `HipUnauthorized`, `HipForbidden`,
  `HipNotFound`, `HipConflict`, `HipInternal`, plus `HipRedirect`) with
  per-adapter translation, decoupling the core from `@hapi/boom`
  ([0baa442](https://github.com/trycatchal/hipthrusts/commit/0baa442)).
- Inference-friendly `define*Handler` helpers for every adapter, including
  `defineTrpcProcedure` ([f395eb9](https://github.com/trycatchal/hipthrusts/commit/f395eb9)).
- `responseMeta` on HTTP-style adapters for declarative status codes and
  headers.
- Dual ESM + CommonJS build via tshy — `import` and `require` both work for
  the root and all subpath exports.
- Test suites for the `user`, `zod`, `mongoose`, and `trpc` modules; coverage
  reporting via `vitest --coverage`.
- GitHub Actions CI (tests on Node 20/22, lint, format, typecheck, build,
  package-exports verification, dual-format smoke tests) and a tag-triggered
  npm publish workflow with provenance.
- OSS meta docs: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `ROADMAP.md`, issue and PR templates.

### Changed

- Lifecycle refactored to be transport-agnostic; stages renamed for clarity
  (`sanitizeInputs`, `preAuthorize`, `loadResources`, `finalAuthorize`,
  `execute`, `redactResponse`, plus optional `extractAmbient`/`extractInputs`)
  ([43b819d](https://github.com/trycatchal/hipthrusts/commit/43b819d),
  [649da56](https://github.com/trycatchal/hipthrusts/commit/649da56)).
- Framework/ODM integrations are optional peer dependencies — install only
  what you use ([#104](https://github.com/trycatchal/hipthrusts/pull/104)).
- Test runner migrated from Mocha to Vitest ([#101](https://github.com/trycatchal/hipthrusts/pull/101)).
- Linting migrated from TSLint (deprecated) to ESLint + typescript-eslint.
- Compile target modernized to ES2022; Node.js >= 20 required.

### Fixed

- Synchronous throws from async-capable stages are now transformed to the
  stage's semantic `HipError` instead of leaking the raw error
  ([#101](https://github.com/trycatchal/hipthrusts/pull/101)).

## [0.11.0] - 2026-04-30

### Added

- `HTPipe` composition for chaining lifecycle fragments with full type
  inference ([#92](https://github.com/trycatchal/hipthrusts/pull/92)).
- Zod validation helpers (`htZodFactory`) ([#91](https://github.com/trycatchal/hipthrusts/pull/91)).
- Inferred lifecycle typing improvements ([#89](https://github.com/trycatchal/hipthrusts/pull/89)).

## [0.10.0] - 2020-05-05

### Changed

- Groundwork for the functional (non-class-based) handler model.

## [0.9.9 – 0.9.15] - 2019-10-31 – 2020-03-16

- Initial public releases: Express + Mongoose oriented handler classes with
  the mandatory-stage lifecycle.

[1.1.0]: https://github.com/trycatchal/hipthrusts/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/trycatchal/hipthrusts/compare/e7205a2...v1.0.0
[0.13.0]: https://github.com/trycatchal/hipthrusts/compare/28fd759...e7205a2
[0.11.0]: https://github.com/trycatchal/hipthrusts/commit/c0fee82
[0.10.0]: https://github.com/trycatchal/hipthrusts/commit/beb8b0d
