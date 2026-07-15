# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor releases may contain breaking changes).

## [Unreleased]

_The entries below fold the previously-unreleased modernization work and the
dogfooding-feedback fixes into the upcoming 0.12.0 release._

### Added (dogfooding feedback round)

- Structured error bodies: HTTP adapters now respond with
  `{ error, issues?, detail? }`. A `ZodError` detail is projected to
  `issues: [{ path, message }]` (paths + messages only — never received input
  values); other `detail` is serialized only when the error was constructed
  with the new `{ expose: true }` opt-in (`HipErrorOptions`); `HipInternal`
  exposes nothing beyond its message. Express merges the same projection into
  the Boom payload. (`hipErrorToBody` in `hipthrusts/errors`.)
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
- `SanitizeInputsSlicesWithZod({ params: P, body: B })`: validate several
  input slices in one fragment with every slice key named in the return type.
- Tenant-scoping helpers in `htMongooseFactory`: `findScoped(Model,
  extraFilter?)` and `loadScopedTo(Model, key, extraFilter?)` compose
  `ctx.queryScope` into the query and type-REQUIRE it, making a missing
  tenant filter a compile error.
- Readable deps-met diagnostics: an unmet context dependency now surfaces as
  `HipDepNotMet<'stage', 'key'>` in the compiler error instead of collapsing
  to `never`; `any`-typed context keys and union stage returns are tolerated.
- Type-level test suite (`vitest --typecheck`, `test/*.test-d.ts`).

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
- `PipedSanitizeInputs` merges the left fragment's named keys through
  passthrough-style right fragments, so piping two `WithInputSlice`
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

[Unreleased]: https://github.com/trycatchal/hipthrusts/compare/master...HEAD
[0.11.0]: https://github.com/trycatchal/hipthrusts/commit/c0fee82
[0.10.0]: https://github.com/trycatchal/hipthrusts/commit/beb8b0d
