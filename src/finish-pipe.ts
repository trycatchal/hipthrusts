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
//   finalAuthorize / execute / redactResponse / responseMeta. Extraction and
//   sanitization stages describe the pipeline's input surface — author them in
//   the pipe (excess-property checking rejects them here).
// - Runtime is literally HTPipe(pipe, handler): pipe stages run first, the
//   handler's stages run after, contributions merge exactly as HTPipe merges
//   them.
// - The composed type keeps the PIPE's stage input requirements visible, so
//   pipe-internal deps-met requirements (e.g. findScoped's `queryScope`) still
//   surface through the adapters as HipDepNotMet.
import { HTPipe } from './index.js';
import { ResponseMeta } from './http-adapter.js';
import { AllStageKeys, PromiseOrSync, UNSAFE_SLICES } from './types.js';

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
type CtxForPreAuthorize<TPipe> = PipeAmbient<TPipe> &
  PipeInputs<TPipe> &
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

// The stage surface the trailing handler may declare. Contextual param types
// all derive from TPipe (and earlier handler stages' returns), so callbacks
// need no annotations.
export interface FinishPipeHandler<TPipe, TPre, TLoad, TFinal, TExec, TResp> {
  preAuthorize?: (context: CtxForPreAuthorize<TPipe>) => TPre;
  loadResources?: (context: CtxForLoadResources<TPipe, TPre>) => TLoad;
  finalAuthorize?: (
    context: CtxForFinalAuthorize<TPipe, TPre, TLoad>
  ) => TFinal;
  execute?: (context: CtxForExecute<TPipe, TPre, TLoad, TFinal>) => TExec;
  redactResponse?: (
    unsafe: UnsafeForRedact<TPipe, TExec>,
    context: CtxForExecute<TPipe, TPre, TLoad, TFinal>
  ) => TResp;
  responseMeta?: ResponseMeta | ((ctx: any) => ResponseMeta);
}

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

export type FinishedPipe<TPipe, TPre, TLoad, TFinal, TExec, TResp, TMeta> =
  FinishedExtractStages<TPipe> &
    FinishedPreAuthorize<TPipe, TPre> &
    FinishedLoadResources<TPipe, TPre, TLoad> &
    FinishedFinalAuthorize<TPipe, TPre, TLoad, TFinal> &
    FinishedExecute<TPipe, TPre, TLoad, TFinal, TExec> &
    FinishedRedactResponse<TPipe, TPre, TLoad, TFinal, TExec, TResp> &
    ([TMeta] extends [never]
      ? NonStageKeys<TPipe>
      : Omit<NonStageKeys<TPipe>, 'responseMeta'> & { responseMeta: TMeta });

export function finishPipe<
  TPipe extends object,
  TPre = never,
  TLoad = never,
  TFinal = never,
  TExec = never,
  TResp = never,
  TMeta extends ResponseMeta | ((ctx: any) => ResponseMeta) = never,
>(
  pipe: TPipe,
  handler: FinishPipeHandler<TPipe, TPre, TLoad, TFinal, TExec, TResp> & {
    responseMeta?: TMeta;
  }
): FinishedPipe<TPipe, TPre, TLoad, TFinal, TExec, TResp, TMeta> {
  return HTPipe(pipe as any, handler as any) as unknown as FinishedPipe<
    TPipe,
    TPre,
    TLoad,
    TFinal,
    TExec,
    TResp,
    TMeta
  >;
}
