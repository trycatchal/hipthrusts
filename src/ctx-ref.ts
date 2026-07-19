// ctxRef: declarative context-path references for loader filter/id specs.
//
// Backend-neutral by design. These markers say "read this value from the
// lifecycle context at request time" and derive a deps-met requirement from
// the path string alone — nothing here is mongoose-specific (the only import
// is the core `NestedPathReq` type). They live in their own subpath
// (`hipthrusts/ctx-ref`) so alternative-backend loaders — a non-mongoose ODM,
// a hand-rolled loader — can emit and recognize the SAME markers the built-in
// mongoose loaders use, without importing the mongoose entrypoint (or its
// peer dependency). `hipthrusts/mongoose` re-exports `ctxRef` / `CtxRef` /
// `CtxRefReq` for backward compatibility with the names it shipped in 1.0.0.

import { NestedPathReq } from './types.js';

// Symbol.for() so the marker survives dual-package (ESM+CJS) loading; the
// unique-symbol assertion lets it be used as a literal key in types.
const CTX_REF: unique symbol = Symbol.for('hipthrusts.ctxRef') as never;

export interface CtxRef<TPath extends string = string> {
  [CTX_REF]: true;
  path: TPath;
}

// Declares "read this value from the lifecycle context at request time" in a
// loader spec: `LoadOneTo(User, 'user', { _id: ctxRef('inputs.body.user') })`.
// The context REQUIREMENT is derived from the path string, so deps-met still
// enforces that an earlier stage provides `inputs.body.user` — with zero
// hand-written context annotations at the call site.
export function ctxRef<TPath extends string>(path: TPath): CtxRef<TPath> {
  return { [CTX_REF]: true, path } as CtxRef<TPath>;
}

// Recognizes a ctxRef marker. Because the marker is keyed by
// `Symbol.for('hipthrusts.ctxRef')`, a guard built here matches refs created
// anywhere in the process — including a foreign module copy that never
// imported `ctxRef` — so alternative loader flavors stay byte-compatible.
export function isCtxRef(value: unknown): value is CtxRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[CTX_REF] === true
  );
}

// The nested context requirement derived from a ctxRef dot path:
// "inputs.body.user" -> { inputs: { body: { user: unknown } } }.
export type CtxRefReq<TPath extends string> = NestedPathReq<TPath>;

type UnionToIntersection<U> = (
  U extends any ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;

// The combined context requirement of every ctxRef in a filter spec; literal
// (non-ref) values contribute nothing. Lets alternative loader flavors derive
// the identical deps-met requirement from a spec without restating the type.
export type SpecReq<TSpec> =
  UnionToIntersection<
    {
      [K in keyof TSpec]: TSpec[K] extends CtxRef<infer TPath>
        ? CtxRefReq<TPath>
        : never;
    }[keyof TSpec]
  > extends infer TReq
    ? [TReq] extends [never]
      ? {}
      : TReq
    : never;
