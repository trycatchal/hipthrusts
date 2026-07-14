import {
  assertHipthrustable,
  executeHipthrustable,
  withDefaultImplementations,
} from './core.js';
import {
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  HasRequiredStages,
  LoadResourcesDepsMet,
  OptionalStagesShape,
  PreAuthorizeDepsMet,
  PromiseOrSync,
  RedactResponseDepsMet,
} from './types.js';

// The raw envelope a tRPC procedure resolver receives: a context and a parsed input.
export interface TrpcRaw<TCtx = unknown, TInput = unknown> {
  ctx: TCtx;
  input: TInput;
}

// Adapter-baseline extractInputs for tRPC: the canonical "inputs" IS the input value itself.
// Per-handler extractInputs chains AFTER this and can wrap/augment as desired.
function trpcBaselineExtractInputs<TInput>(
  raw: TrpcRaw<unknown, TInput>
): TInput {
  return raw.input;
}

// Handler config the dev writes for a tRPC procedure. `extractInputs` chains
// AFTER the adapter baseline (which hands through the parsed `input`); if
// omitted, the parsed input flows directly to sanitizeInputs. There is no
// responseMeta/status here — tRPC procedures return their value directly.
type TrpcHandlerConfig<
  TCtx = unknown,
  TInput = unknown,
  TInputs = TInput,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown
> = {
  extractAmbient?: (raw: TrpcRaw<TCtx, TInput>) => TAmbient;
  extractInputs?: (canonical: TInput) => TInputs;
  sanitizeInputs: (unsafe: TInputs) => TSafeInputs;
  preAuthorize: (
    context: { inputs: Awaited<TSafeInputs> } & ([TAmbient] extends [never]
      ? {}
      : { ambient: TAmbient })
  ) => TPreAuthOut;
  loadResources?: (
    context: { inputs: Awaited<TSafeInputs> } & ([TAmbient] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      Awaited<TPreAuthOut>
  ) => PromiseOrSync<TLoadResourcesOut>;
  finalAuthorize: (
    context: { inputs: Awaited<TSafeInputs> } & ([TAmbient] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      Awaited<TPreAuthOut> &
      Awaited<TLoadResourcesOut>
  ) => PromiseOrSync<TFinalAuthOut>;
  execute: (
    context: { inputs: Awaited<TSafeInputs> } & ([TAmbient] extends [never]
      ? {}
      : { ambient: TAmbient }) &
      Awaited<TPreAuthOut> &
      Awaited<TLoadResourcesOut> &
      Awaited<TFinalAuthOut>
  ) => PromiseOrSync<TUnsafeResponse>;
  redactResponse: (unsafe: Awaited<TUnsafeResponse>) => TResponse;
};

type InferredTrpcConfig = OptionalStagesShape & HasRequiredStages;

// Identity function for inference-friendly tRPC config authoring. Mirrors
// defineExpressHandler; pass the result to toTrpcProcedure.
export const defineTrpcProcedure = <
  TCtx = unknown,
  TInput = unknown,
  TInputs = TInput,
  TSafeInputs = any,
  TAmbient = never,
  TPreAuthOut = unknown,
  TLoadResourcesOut = unknown,
  TFinalAuthOut = unknown,
  TUnsafeResponse = unknown,
  TResponse = unknown
>(
  config: TrpcHandlerConfig<
    TCtx,
    TInput,
    TInputs,
    TSafeInputs,
    TAmbient,
    TPreAuthOut,
    TLoadResourcesOut,
    TFinalAuthOut,
    TUnsafeResponse,
    TResponse
  >
): InferredTrpcConfig => (config as unknown) as InferredTrpcConfig;

export function toTrpcProcedure<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf>
>(handlingStrategy: TConf) {
  assertHipthrustable(handlingStrategy);

  const handlerExtract = (handlingStrategy as any).extractInputs;
  const composedExtractInputs = handlerExtract
    ? (raw: TrpcRaw) => {
        const canonical = trpcBaselineExtractInputs(raw);
        const additions = handlerExtract(canonical) || {};
        if (
          canonical !== null &&
          typeof canonical === 'object' &&
          additions !== null &&
          typeof additions === 'object'
        ) {
          return { ...(canonical as object), ...(additions as object) };
        }
        // For non-object inputs, the handler's extractInputs fully owns the result.
        return additions;
      }
    : trpcBaselineExtractInputs;

  const strategyWithBaseline = {
    ...handlingStrategy,
    extractInputs: composedExtractInputs,
  };

  const fullHipthrustable = withDefaultImplementations(
    strategyWithBaseline as any
  );

  return async <TCtx, TInput>({ ctx, input }: { ctx: TCtx; input: TInput }) => {
    const { response } = await executeHipthrustable(fullHipthrustable as any, {
      ctx,
      input,
    });
    // tRPC procedures return the value directly. A thrown HipError propagates
    // with its `.kind`; map it in your tRPC `errorFormatter` if you want
    // specific TRPCError codes. There is no HTTP response metadata here.
    return response;
  };
}
