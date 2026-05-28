import {
  assertHipthrustable,
  executeHipthrustable,
  HasSuccessStatus,
  withDefaultImplementations,
} from './core';
import {
  LoadResourcesDepsMet,
  ExecuteDepsMet,
  FinalAuthorizeDepsMet,
  OptionalStagesShape,
  HasRequiredStages,
  PreAuthorizeDepsMet,
  RedactResponseDepsMet,
} from './types';

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

export function hipTrpcProcedure<
  TConf extends OptionalStagesShape &
    HasRequiredStages &
    PreAuthorizeDepsMet<TConf> &
    LoadResourcesDepsMet<TConf> &
    FinalAuthorizeDepsMet<TConf> &
    ExecuteDepsMet<TConf> &
    RedactResponseDepsMet<TConf> &
    HasSuccessStatus
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
    const { response } = await executeHipthrustable(
      fullHipthrustable as any,
      { ctx, input },
      200
    );
    // tRPC procedures return the value directly. successStatus is silently ignored.
    return response;
  };
}
