# Contributing to HipThrusTS

Thanks for your interest in making backends stronger and leaner!

## Getting set up

Requirements: Node.js >= 20 and pnpm (via corepack).

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Everyday commands

| Command | What it does |
| ------- | ------------ |
| `pnpm test` | run the vitest suite |
| `pnpm test:watch` | run tests in watch mode |
| `pnpm test:coverage` | run tests with a coverage report |
| `pnpm typecheck` | type-check src, tests, and examples |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier (write) |
| `pnpm build` | build dual ESM + CJS output to `dist/` via tshy |
| `pnpm check:exports` | verify package exports resolve for all module systems |
| `pnpm smoke` | require + import every subpath from the built package |
| `pnpm docs:build` | generate the TypeDoc API reference into `doc/` |

CI runs `test` (Node 20 and 22), `lint`, `format:check`, `typecheck`,
`build`, `check:exports`, and `smoke` — running those locally before pushing
saves you a round trip.

## Guidelines

- **The type system is the product.** Changes to `src/types.ts` and the
  `HTPipe` overloads in `src/index.ts` deserve type-level tests — see the
  `@ts-expect-error` fixtures in `test/index.test.ts` for the pattern.
- Keep the required-lifecycle-stage guarantee intact: nothing may make a
  handler runnable without `sanitizeInputs`, `preAuthorize`,
  `finalAuthorize`, `execute`, and `redactResponse`.
- New framework/ODM adapters should live in their own `src/<name>.ts`, get a
  subpath export (see the `tshy.exports` map in package.json), an optional
  peer dependency, tests, and a runnable example in `examples/`.
- Relative imports inside `src/` need explicit `.js` extensions (the build
  targets Node's ESM resolution).
- Security reports go through [SECURITY.md](./SECURITY.md), not public issues.

## Pull requests

1. Fork and branch from `master`.
2. Make your change with tests.
3. Ensure the full local gate passes.
4. Open a PR describing the motivation and the approach.
