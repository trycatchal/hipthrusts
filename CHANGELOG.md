# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor releases may contain breaking changes).

## [Unreleased]

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
