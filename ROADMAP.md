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
