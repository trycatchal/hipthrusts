# HipThrusTS documentation

Start with the [overview / quick tour](../README.md) — the pitch, the
lifecycle at a glance, install, and a first endpoint. Then go deep by
topic:

| Page | What's in it |
|------|--------------|
| [The lifecycle, in detail](./lifecycle.md) | All eight stages, the context each receives, input slices & the strictness guarantee |
| [Composition](./composition.md) | `HTPipe`, shared fragments, partial pipelines, `finishPipe`, type troubleshooting |
| [Errors & failure routing](./errors.md) | The `HipError` vocabulary, error bodies, unexpected-error routing, the auth-before-validation gate |
| [Adapters](./adapters.md) | Express, tRPC, Hono, Fastify, Next.js; `responseMeta`, `onError` / `afterResponse` options |
| [Zod validation helpers](./validation.md) | Schema-backed sanitization & redaction, codec-style wire schemas, switches |
| [Mongoose helpers & data loading](./mongoose.md) | Everyday loaders, `ctxRef`, tenant scoping for list endpoints |

The generated **API reference** (every export, from source) lives at
[trycatchal.github.io/hipthrusts](https://trycatchal.github.io/hipthrusts/).

Diagrams are hand-drawn SVGs in [`img/`](./img) plus Mermaid blocks in
the pages themselves — plain text either way, reviewed in the same diff
as the code they describe, drawn theme-neutral so they read correctly in
both light and dark mode.
