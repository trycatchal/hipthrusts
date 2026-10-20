// finishPipe: compose a shared partial pipeline (auth, sanitization, loaders)
// with ONE endpoint-specific trailing handler — the dominant authoring shape —
// such that the trailing handler's stage callbacks get their context parameter
// types INFERRED from the pipe. HTPipe can't do this by itself: it infers its
// type parameters FROM the fragments, so contextual typing can't flow INTO
// them and every stage callback must hand-declare the context it consumes.
// finishPipe computes the pipe's accumulated context from the pipe's TYPE
// instead, so trailing stages need zero annotations and consuming a phantom
// context key is a compile error.
//
// Limitations (by design):
// - The trailing handler may only declare preAuthorize / loadResources /
//   finalAuthorize / etag / execute / redactResponse / responseMeta.
//   Extraction and sanitization stages describe the pipeline's input surface
//   — author them in the pipe (excess-property checking rejects them here).
// - Runtime is literally HTPipe(pipe, handler): pipe stages run first, the
//   handler's stages run after, contributions merge exactly as HTPipe merges
//   them.
// - The composed type keeps the PIPE's stage input requirements visible, so
//   pipe-internal deps-met requirements (e.g. findScoped's `queryScope`) still
//   surface through the adapters as HipDepNotMet.
import { HTPipe } from './index.js';
import { ResponseMeta } from './http-adapter.js';
import {
  AllStageKeys,
  ETagResult,
  HasDefer,
  HipReservedContextKey,
  PromiseOrSync,
  ReservedContextKey,
  UNSAFE_SLICES,
} from './types.js';

// Strips index signatures, keeping only statically-known keys (mirrors the
// KnownKeys used for HTPipe's sanitize merging).
type KnownKeys<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K];
};

// PITFALL guard: Exclude<boolean-only-return, boolean> = never, never extends
// object, and one never annihilates the whole context intersection — so never
// MUST resolve to {} before the object test.
type ObjOr<T> = [T] extends [never] ? {} : [T] extends [object] ? T : {};

// What an authorization stage CONTRIBUTES to context: its object returns.
// Boolean returns (pass/deny) contribute nothing.
type AuthContrib<T> = ObjOr<Exclude<Awaited<T>, boolean>>;

type PipeAmbient<TPipe> = TPipe extends {
  extractAmbient: (raw: any) => infer TAmbient;
}
  ? { ambient: Awaited<TAmbient> }
  : {};

// KnownKeys + the explicit Omit strip the UNSAFE_SLICES raw-remainder channel
// and any index-signature carriers from slice sanitizers, matching what core
// actually passes downstream (SanitizedOnly at runtime).
type PipeInputs<TPipe> = TPipe extends {
  sanitizeInputs: (unsafe: any) => infer TSafe;
}
  ? { inputs: KnownKeys<Omit<Awaited<TSafe>, typeof UNSAFE_SLICES>> }
  : {};

type PipePre<TPipe> = TPipe extends {
  preAuthorize: (context: any) => infer TOut;
}
  ? AuthContrib<TOut>
  : {};

type PipeLoad<TPipe> = TPipe extends {
  loadResources: (context: any) => infer TOut;
}
  ? ObjOr<Awaited<TOut>>
  : {};

type PipeFinal<TPipe> = TPipe extends {
  finalAuthorize: (context: any) => infer TOut;
}
  ? AuthContrib<TOut>
  : {};

type PipeExec<TPipe> = TPipe extends { execute: (context: any) => infer TOut }
  ? Awaited<TOut>
  : never;

type PipeRedacted<TPipe> = TPipe extends {
  redactResponse: (unsafe: any, context?: any) => infer TOut;
}
  ? TOut
  : never;

// Accumulated context types at each trailing-handler stage boundary.
// `defer` is provided by the lifecycle from preAuthorize onward.
type CtxForPreAuthorize<TPipe> = PipeAmbient<TPipe> &
  PipeInputs<TPipe> &
  HasDefer &
  PipePre<TPipe>;
type CtxForLoadResources<TPipe, TPre> = CtxForPreAuthorize<TPipe> &
  AuthContrib<TPre> &
  PipeLoad<TPipe>;
type CtxForFinalAuthorize<TPipe, TPre, TLoad> = CtxForLoadResources<
  TPipe,
  TPre
> &
  ObjOr<Awaited<TLoad>> &
  PipeFinal<TPipe>;
type CtxForExecute<TPipe, TPre, TLoad, TFinal> = CtxForFinalAuthorize<
  TPipe,
  TPre,
  TLoad
> &
  AuthContrib<TFinal>;

// The full accumulated context a pipe provides (through finalAuthorize) — the
// first-class utility behind finishPipe, exported for anyone computing pipe
// context types by hand.
export type PipeContext<TPipe> = CtxForFinalAuthorize<TPipe, never, never>;

// What the trailing handler's redactResponse receives as `unsafe`: the pipe's
// redactor output if the pipe has one (HTPipe chains redactors left-to-right),
// otherwise the execute output (the handler's if declared, else the pipe's).
type ExecOut<TPipe, TExec> = [TExec] extends [never]
  ? PipeExec<TPipe>
  : Awaited<TExec>;
type UnsafeForRedact<TPipe, TExec> = [PipeRedacted<TPipe>] extends [never]
  ? [ExecOut<TPipe, TExec>] extends [never]
    ? unknown
    : ExecOut<TPipe, TExec>
  : PipeRedacted<TPipe>;

// What the response is: the handler's redactor output when it declares one
// (HTPipe chains the pipe's redactor into it), else the pipe's.
type RespOut<TPipe, TResp> = [TResp] extends [never]
  ? [PipeRedacted<TPipe>] extends [never]
    ? unknown
    : PipeRedacted<TPipe>
  : TResp;

type PipeResponseMeta<TPipe> = TPipe extends { responseMeta?: infer TMeta }
  ? Exclude<TMeta, undefined>
  : never;

type PipeHasETag<TPipe> = TPipe extends { etag: (context: any) => any }
  ? true
  : false;

// The final context the adapters hand to a functional responseMeta (and to
// afterResponse): everything execute saw, execute's output keys, and
// `response`. When an etag stage exists, a 304 is possible: execute and
// redactResponse were skipped, so that branch has no execute keys and no
// `response` — narrow with `if (ctx.response)` (or `'response' in ctx`).
export type FinishedContext<TPipe, TPre, TLoad, TFinal, TExec, TResp, TETag> =
  | (CtxForExecute<TPipe, TPre, TLoad, TFinal> &
      ObjOr<ExecOut<TPipe, TExec>> & {
        response: RespOut<TPipe, TResp>;
      })
  | ([TETag] extends [never]
      ? PipeHasETag<TPipe> extends true
        ? NotModifiedContext<TPipe, TPre, TLoad, TFinal>
        : never
      : NotModifiedContext<TPipe, TPre, TLoad, TFinal>);

type NotModifiedContext<TPipe, TPre, TLoad, TFinal> = CtxForExecute<
  TPipe,
  TPre,
  TLoad,
  TFinal
> & { response?: undefined };

// The stage surface the trailing handler may declare. Contextual param types
// all derive from TPipe (and earlier handler stages' returns), so callbacks
// need no annotations.
//
// Every context parameter is `NoInfer<computed ctx> & TReq*`:
// - NoInfer: TPre/TLoad/TFinal are inferred from stage RETURNS only.
//   Otherwise a stage built elsewhere with an `any` parameter — e.g. a spread
//   RedactResponseWithZod, whose redactor takes `context?: any` — infers
//   `any` back into them and silently erases every other stage's ctx to `any`.
// - TReq*: a stage built elsewhere (a spread RedactResponseSwitch, a shared
//   authorizer) declares the context it needs. That declaration is inferred
//   into its own type parameter instead, where an `any` is harmless, and is
//   checked against the real context in finishPipe's return type, once
//   inference is complete (checking it in the parameter would reject the
//   call before the earlier stages' returns are known). An inline,
//   unannotated callback leaves TReq* at `unknown`, so it sees exactly the
//   computed context.
//
// Declare stages in lifecycle order (responseMeta last): each stage's context
// is computed from the returns of the stages before it.
export interface FinishPipeHandler<
  TPipe,
  TPre,
  TLoad,
  TFinal,
  TExec,
  TResp,
  TETag = never,
  TReqPre = unknown,
  TReqLoad = unknown,
  TReqFinal = unknown,
  TReqETag = unknown,
  TReqExec = unknown,
  TReqRedact = unknown,
> {
  preAuthorize?: (
    context: NoInfer<CtxForPreAuthorize<TPipe>> & TReqPre
  ) => TPre;
  loadResources?: (
    context: NoInfer<CtxForLoadResources<TPipe, TPre>> & TReqLoad
  ) => TLoad;
  finalAuthorize?: (
    context: NoInfer<CtxForFinalAuthorize<TPipe, TPre, TLoad>> & TReqFinal
  ) => TFinal;
  // Conditional GET (see OptionallyHasETag): runs after finalAuthorize, so it
  // sees finalAuthorize's contributions.
  etag?: (
    context: NoInfer<CtxForExecute<TPipe, TPre, TLoad, TFinal>> & TReqETag
  ) => TETag;
  execute?: (
    context: NoInfer<CtxForExecute<TPipe, TPre, TLoad, TFinal>> & TReqExec
  ) => TExec;
  // `unsafe` stays inferable: a pre-built redactor's declared input is a
  // legitimate TExec candidate alongside execute's return.
  redactResponse?: (
    unsafe: UnsafeForRedact<TPipe, TExec>,
    context: NoInfer<CtxForExecute<TPipe, TPre, TLoad, TFinal>> & TReqRedact
  ) => TResp;
  responseMeta?: FinishPipeResponseMeta<
    TPipe,
    TPre,
    TLoad,
    TFinal,
    TExec,
    TResp,
    TETag
  >;
}

// A pre-built trailing stage whose declared context requirement the computed
// context doesn't satisfy. finishPipe RETURNS this instead of the finished
// pipe, so handing it to an adapter fails with the stage and the keys named.
export interface HipTrailingDepNotMet<TStage extends string, TKeys> {
  __hipTrailingDepNotMet: [TStage, TKeys];
}

// `any` / `unknown` requirements (inline callbacks, `(ctx: any) =>` stages)
// are always met.
type UnmetReq<TStage extends string, TCtx, TReq> = 0 extends 1 & TReq
  ? never
  : unknown extends TReq
    ? never
    : [TCtx] extends [TReq]
      ? never
      : HipTrailingDepNotMet<
          TStage,
          // Name the absent keys when there are any, else every required key
          // (a key is present with an incompatible type).
          [Exclude<keyof TReq, keyof TCtx>] extends [never]
            ? keyof TReq
            : Exclude<keyof TReq, keyof TCtx>
        >;

type TrailingReqsUnmet<
  TPipe,
  TPre,
  TLoad,
  TFinal,
  TReqPre,
  TReqLoad,
  TReqFinal,
  TReqETag,
  TReqExec,
  TReqRedact,
> =
  | UnmetReq<'preAuthorize', CtxForPreAuthorize<TPipe>, TReqPre>
  | UnmetReq<'loadResources', CtxForLoadResources<TPipe, TPre>, TReqLoad>
  | UnmetReq<
      'finalAuthorize',
      CtxForFinalAuthorize<TPipe, TPre, TLoad>,
      TReqFinal
    >
  | UnmetReq<'etag', CtxForExecute<TPipe, TPre, TLoad, TFinal>, TReqETag>
  | UnmetReq<'execute', CtxForExecute<TPipe, TPre, TLoad, TFinal>, TReqExec>
  | UnmetReq<
      'redactResponse',
      CtxForExecute<TPipe, TPre, TLoad, TFinal>,
      TReqRedact
    >;

export type FinishPipeResponseMeta<
  TPipe,
  TPre,
  TLoad,
  TFinal,
  TExec,
  TResp,
  TETag,
> =
  | ResponseMeta
  | ((
      ctx: NoInfer<
        FinishedContext<TPipe, TPre, TLoad, TFinal, TExec, TResp, TETag>
      >
    ) => ResponseMeta);

// Type half of the reserved `defer` key for the trailing handler's own
// stages (the pipe's are covered by the adapters' ReservedKeysUnshadowed).
type ShadowsReserved<T> = 0 extends 1 & T
  ? never
  : T extends object
    ? keyof T & ReservedContextKey
    : never;
type TrailingUnshadowed<TPre, TLoad, TFinal> = ([
  ShadowsReserved<Awaited<TPre>>,
] extends [never]
  ? {}
  : {
      preAuthorize: HipReservedContextKey<
        'preAuthorize',
        ShadowsReserved<Awaited<TPre>>
      >;
    }) &
  ([ShadowsReserved<Awaited<TLoad>>] extends [never]
    ? {}
    : {
        loadResources: HipReservedContextKey<
          'loadResources',
          ShadowsReserved<Awaited<TLoad>>
        >;
      }) &
  ([ShadowsReserved<Awaited<TFinal>>] extends [never]
    ? {}
    : {
        finalAuthorize: HipReservedContextKey<
          'finalAuthorize',
          ShadowsReserved<Awaited<TFinal>>
        >;
      });

// --- Composed result type -------------------------------------------------
// Each stage keeps the PIPE's declared input type (that's what preserves
// HipDepNotMet enforcement for pipe-internal deps) while claiming the merged
// return of pipe stage + handler stage. `[THandlerReturn] extends [never]`
// detects "handler did not declare this stage" (the generic's default).

type FinishedPreAuthorize<TPipe, TPre> = TPipe extends {
  preAuthorize: (context: infer TCtxIn) => infer TOut;
}
  ? [TPre] extends [never]
    ? { preAuthorize: (context: TCtxIn) => TOut }
    : {
        preAuthorize: (
          context: TCtxIn
        ) => false | (AuthContrib<TOut> & AuthContrib<TPre>);
      }
  : [TPre] extends [never]
    ? {}
    : { preAuthorize: (context: CtxForPreAuthorize<TPipe>) => TPre };

type FinishedLoadResources<TPipe, TPre, TLoad> = TPipe extends {
  loadResources: (context: infer TCtxIn) => infer TOut;
}
  ? [TLoad] extends [never]
    ? { loadResources: (context: TCtxIn) => TOut }
    : {
        loadResources: (
          context: TCtxIn
        ) => Promise<ObjOr<Awaited<TOut>> & ObjOr<Awaited<TLoad>>>;
      }
  : [TLoad] extends [never]
    ? {}
    : { loadResources: (context: CtxForLoadResources<TPipe, TPre>) => TLoad };

type FinishedFinalAuthorize<TPipe, TPre, TLoad, TFinal> = TPipe extends {
  finalAuthorize: (context: infer TCtxIn) => infer TOut;
}
  ? [TFinal] extends [never]
    ? { finalAuthorize: (context: TCtxIn) => TOut }
    : {
        finalAuthorize: (
          context: TCtxIn
        ) => PromiseOrSync<false | (AuthContrib<TOut> & AuthContrib<TFinal>)>;
      }
  : [TFinal] extends [never]
    ? {}
    : {
        finalAuthorize: (
          context: CtxForFinalAuthorize<TPipe, TPre, TLoad>
        ) => TFinal;
      };

type FinishedExecute<TPipe, TPre, TLoad, TFinal, TExec> = TPipe extends {
  execute: (context: infer TCtxIn) => infer TOut;
}
  ? [TExec] extends [never]
    ? { execute: (context: TCtxIn) => TOut }
    : // HTPipe runs both executes and returns the RIGHT (handler) result.
      { execute: (context: TCtxIn) => Promise<Awaited<TExec>> }
  : [TExec] extends [never]
    ? {}
    : {
        execute: (context: CtxForExecute<TPipe, TPre, TLoad, TFinal>) => TExec;
      };

type FinishedRedactResponse<TPipe, TPre, TLoad, TFinal, TExec, TResp> =
  TPipe extends {
    redactResponse: (unsafe: infer TUnsafeIn, context?: any) => infer TOut;
  }
    ? [TResp] extends [never]
      ? { redactResponse: (unsafe: TUnsafeIn, context?: any) => TOut }
      : { redactResponse: (unsafe: TUnsafeIn, context?: any) => TResp }
    : [TResp] extends [never]
      ? {}
      : {
          redactResponse: (
            unsafe: UnsafeForRedact<TPipe, TExec>,
            context: CtxForExecute<TPipe, TPre, TLoad, TFinal>
          ) => TResp;
        };

type FinishedExtractStages<TPipe> = (TPipe extends {
  extractAmbient: infer TFn extends (...args: any[]) => any;
}
  ? { extractAmbient: TFn }
  : {}) &
  (TPipe extends { extractInputs: infer TFn extends (...args: any[]) => any }
    ? { extractInputs: TFn }
    : {}) &
  (TPipe extends { sanitizeInputs: infer TFn extends (...args: any[]) => any }
    ? { sanitizeInputs: TFn }
    : {});

// Non-stage keys (e.g. responseMeta) pass through with right-wins semantics,
// same as HTPipe.
type NonStageKeys<T> = Omit<KnownKeys<T>, AllStageKeys>;

// Non-stage keys the handler declares (responseMeta, etag) replace the
// pipe's, right-wins. A STATIC handler responseMeta keeps its exact type
// (TMeta). A functional one can't be told apart from an absent one without
// breaking its contextual typing, so the result then types responseMeta as
// "the pipe's, or a function of the final context", optional.
type FinishedNonStageKeys<
  TPipe,
  TPre,
  TLoad,
  TFinal,
  TExec,
  TResp,
  TMeta,
  TETag,
> = Omit<
  NonStageKeys<TPipe>,
  'responseMeta' | ([TETag] extends [never] ? never : 'etag')
> &
  ([TMeta] extends [never]
    ? {
        responseMeta?:
          | PipeResponseMeta<TPipe>
          | ((
              ctx: FinishedContext<
                TPipe,
                TPre,
                TLoad,
                TFinal,
                TExec,
                TResp,
                TETag
              >
            ) => ResponseMeta);
      }
    : { responseMeta: TMeta }) &
  ([TETag] extends [never]
    ? {}
    : {
        etag: (context: CtxForExecute<TPipe, TPre, TLoad, TFinal>) => TETag;
      });

export type FinishedPipe<
  TPipe,
  TPre,
  TLoad,
  TFinal,
  TExec,
  TResp,
  TMeta,
  TETag = never,
> = FinishedExtractStages<TPipe> &
  FinishedPreAuthorize<TPipe, TPre> &
  FinishedLoadResources<TPipe, TPre, TLoad> &
  FinishedFinalAuthorize<TPipe, TPre, TLoad, TFinal> &
  FinishedExecute<TPipe, TPre, TLoad, TFinal, TExec> &
  FinishedRedactResponse<TPipe, TPre, TLoad, TFinal, TExec, TResp> &
  FinishedNonStageKeys<TPipe, TPre, TLoad, TFinal, TExec, TResp, TMeta, TETag>;

export function finishPipe<
  TPipe extends object,
  TPre = never,
  TLoad = never,
  TFinal = never,
  TExec = never,
  TResp = never,
  // Inferred only from a STATIC responseMeta object, so the result keeps its
  // exact type. A functional responseMeta is contextually typed by the final
  // context instead (a type parameter there would fix TExec/TResp early).
  TMeta extends ResponseMeta = never,
  TETag extends PromiseOrSync<ETagResult> = never,
  TReqPre = unknown,
  TReqLoad = unknown,
  TReqFinal = unknown,
  TReqETag = unknown,
  TReqExec = unknown,
  TReqRedact = unknown,
>(
  pipe: TPipe,
  handler: Omit<
    FinishPipeHandler<
      TPipe,
      TPre,
      TLoad,
      TFinal,
      TExec,
      TResp,
      TETag,
      TReqPre,
      TReqLoad,
      TReqFinal,
      TReqETag,
      TReqExec,
      TReqRedact
    >,
    'responseMeta'
  > & {
    responseMeta?:
      | TMeta
      | FinishPipeResponseMeta<TPipe, TPre, TLoad, TFinal, TExec, TResp, TETag>;
  } & TrailingUnshadowed<TPre, TLoad, TFinal>
): [
  TrailingReqsUnmet<
    TPipe,
    TPre,
    TLoad,
    TFinal,
    TReqPre,
    TReqLoad,
    TReqFinal,
    TReqETag,
    TReqExec,
    TReqRedact
  >,
] extends [never]
  ? FinishedPipe<TPipe, TPre, TLoad, TFinal, TExec, TResp, TMeta, TETag>
  : TrailingReqsUnmet<
      TPipe,
      TPre,
      TLoad,
      TFinal,
      TReqPre,
      TReqLoad,
      TReqFinal,
      TReqETag,
      TReqExec,
      TReqRedact
    > {
  return HTPipe(pipe as any, handler as any) as any;
}
