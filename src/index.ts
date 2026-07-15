import {
  authorizationPassed,
  isHasExecute,
  isHasExtractAmbient,
  isHasExtractInputs,
  isHasFinalAuthorize,
  isHasLoadResources,
  isHasPreAuthorize,
  isHasRedactResponse,
  isHasSanitizeInputs,
} from './core.js';
import {
  Execute,
  ExtractAmbient,
  ExtractInputs,
  FinalAuthorize,
  LoadResources,
  PreAuthorize,
  RedactResponse,
  SanitizeInputs,
} from './lifecycle-functions.js';
import {
  AllStageKeys,
  AllStagesOptionalShape,
  HasExecute,
  HasUnsafeSlices,
  HasExtractAmbient,
  HasExtractInputs,
  HasFinalAuthorize,
  HasLoadResources,
  HasPreAuthorize,
  HasRedactResponse,
  HasSanitizeInputs,
  OptionallyHasExecute,
  OptionallyHasExtractAmbient,
  OptionallyHasExtractInputs,
  OptionallyHasFinalAuthorize,
  OptionallyHasLoadResources,
  OptionallyHasPreAuthorize,
  OptionallyHasRedactResponse,
  OptionallyHasSanitizeInputs,
  PromiseResolveOrSync,
  UNSAFE_SLICES,
} from './types.js';

type FunctionTaking<TIn> = (param: TIn) => any;

type HasTypedFunctionOn<T, K extends string> = Record<K, FunctionTaking<T>>;

export function fromWrappedInstanceMethod<
  TIn,
  TOut extends ReturnType<TInstance[TMethodName]>,
  TInstance extends HasTypedFunctionOn<TIn, TMethodName>,
  TMethodName extends string,
>(instanceMethodName: TMethodName) {
  return function (instance: TInstance) {
    return Promise.resolve(function (arg: TIn): Promise<TOut> {
      return Promise.resolve(instance[instanceMethodName](arg) as TOut);
    });
  };
}

export function NoopPreAuth() {
  return PreAuthorize(() => true);
}

export function NoopFinalAuth() {
  return FinalAuthorize(() => true);
}

export function ExtractAmbientFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return ExtractAmbient((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function ExtractAmbientTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return ExtractAmbient((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx) };
  });
}

export function ExtractAmbientFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return ExtractAmbient((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx[whereToLook]) };
  });
}

export function ExtractInputsFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return ExtractInputs((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function ExtractInputsTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return ExtractInputs((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx) };
  });
}

export function ExtractInputsFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return ExtractInputs((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx[whereToLook]) };
  });
}

export function SanitizeInputsFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return SanitizeInputs((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function SanitizeInputsTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return SanitizeInputs((htCtx: TContextIn) => {
    return {
      [whereToStore]: projector(htCtx),
    };
  });
}

export function SanitizeInputsFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return SanitizeInputs((htCtx: TContextIn) => {
    return {
      [whereToStore]: projector(htCtx[whereToLook]),
    };
  });
}

// Per-slice sanitization for HTTP-style handlers whose inputs are the
// canonical { params, query, body, headers } object. Each named slice is
// sanitized by its function; the RAW remainder travels to the next chained
// sanitizer under UNSAFE_SLICES only — core deletes that key after the
// sanitize stage, so ONLY explicitly-sanitized slices reach later stages
// (want a raw slice through? say so: `{ query: (q) => q }`). Fragments chain
// via HTPipe: a later fragment's slices are added (right wins on a clash,
// re-sanitizing from the raw slice), and its output carries the union of all
// named slices.
export function SanitizeInputsSlices<
  TSanitizers extends Record<string, (unsafeSlice: any) => any>,
>(sanitizers: TSanitizers) {
  type SafeSlices = {
    [K in keyof TSanitizers]: ReturnType<TSanitizers[K]>;
  };
  return SanitizeInputs(
    (unsafeInputs: Record<string, any>): SafeSlices & HasUnsafeSlices => {
      const chained =
        unsafeInputs !== null &&
        typeof unsafeInputs === 'object' &&
        UNSAFE_SLICES in unsafeInputs;
      // First fragment in a chain receives the raw inputs; later fragments
      // receive the previous fragment's { ...safe, [UNSAFE_SLICES]: raw }.
      const rawSlices: Record<string, any> = chained
        ? (unsafeInputs as Record<PropertyKey, any>)[UNSAFE_SLICES]
        : unsafeInputs;
      const out: Record<PropertyKey, any> = chained ? { ...unsafeInputs } : {};
      for (const sliceName of Object.keys(sanitizers)) {
        out[sliceName] = sanitizers[sliceName](rawSlices[sliceName]);
      }
      out[UNSAFE_SLICES] = rawSlices;
      return out as SafeSlices & HasUnsafeSlices;
    }
  );
}

export function PreAuthorizeFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object | boolean,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return PreAuthorize((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function PreAuthorizeTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object | boolean,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return PreAuthorize((htCtx: TContextIn) => {
    const preAuthorizeResult = projector(htCtx);
    return authorizationPassed(preAuthorizeResult)
      ? {
          [whereToStore]: preAuthorizeResult,
        }
      : false;
  });
}

export function PreAuthorizeFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object | boolean,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return PreAuthorize((htCtx: TContextIn) => {
    const preAuthorizeResult = projector(htCtx[whereToLook]);
    return authorizationPassed(preAuthorizeResult)
      ? { [whereToStore]: preAuthorizeResult }
      : false;
  });
}

export function LoadResourcesFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends PromiseResolveOrSync<object>,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return LoadResources((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function LoadResourcesTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return LoadResources(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx)),
    };
  });
}

export function LoadResourcesFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return LoadResources(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx[whereToLook])),
    };
  });
}

export function FinalAuthorizeFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends PromiseResolveOrSync<object | boolean>,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return FinalAuthorize((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function FinalAuthorizeTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends PromiseResolveOrSync<object | boolean>,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return FinalAuthorize(async (htCtx: TContextIn) => {
    const finalAuthorizeResult = await Promise.resolve(projector(htCtx));
    return authorizationPassed(finalAuthorizeResult)
      ? { [whereToStore]: finalAuthorizeResult }
      : false;
  });
}

export function FinalAuthorizeFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends PromiseResolveOrSync<object | boolean>,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return FinalAuthorize(async (htCtx: TContextIn) => {
    const finalAuthorizeResult = await Promise.resolve(
      projector(htCtx[whereToLook])
    );
    return authorizationPassed(finalAuthorizeResult)
      ? { [whereToStore]: finalAuthorizeResult }
      : false;
  });
}

export function ExecuteFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TUnsafeResponse,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TUnsafeResponse
) {
  return Execute((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function ExecuteTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TUnsafeResponse,
>(
  projector: (htCtx: TContextIn) => TUnsafeResponse,
  whereToStore: TWhereToStore
) {
  return Execute(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx)),
    };
  });
}

export function ExecuteFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TUnsafeResponse,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TUnsafeResponse,
  whereToStore: TWhereToStore
) {
  return Execute(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx[whereToLook])),
    };
  });
}

export function RedactResponseFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return RedactResponse((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function RedactResponseTo<
  TWhereToStore extends string,
  TContextIn,
  TContextOut,
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return RedactResponse((htCtx: TContextIn) => {
    return {
      [whereToStore]: projector(htCtx),
    };
  });
}

export function RedactResponseFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut,
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return RedactResponse((htCtx: TContextIn) => {
    return {
      [whereToStore]: projector(htCtx[whereToLook]),
    };
  });
}

type ExtractAmbientIn<T extends HasExtractAmbient<any, any>> = Parameters<
  T['extractAmbient']
>[0];
type ExtractAmbientReturn<T extends HasExtractAmbient<any, any>> = ReturnType<
  T['extractAmbient']
>;

type ExtractInputsContextIn<T extends HasExtractInputs<any, any>> = Parameters<
  T['extractInputs']
>[0];
type ExtractInputsReturn<T extends HasExtractInputs<any, any>> = ReturnType<
  T['extractInputs']
>;

type SanitizeInputsContextIn<T extends HasSanitizeInputs<any, any>> =
  Parameters<T['sanitizeInputs']>[0];
type SanitizeInputsReturn<T extends HasSanitizeInputs<any, any>> = ReturnType<
  T['sanitizeInputs']
>;

type PreAuthorizeContextIn<T extends HasPreAuthorize<any, any>> = Parameters<
  T['preAuthorize']
>[0];
type PreAuthorizeReturn<T extends HasPreAuthorize<any, any>> = ReturnType<
  T['preAuthorize']
>;
type PreAuthorizeContextOut<T extends HasPreAuthorize<any, any>> = object &
  ReturnType<T['preAuthorize']>;
type PreAuthorizeContextOutFalseCase<T extends HasPreAuthorize<any, any>> =
  false & ReturnType<T['preAuthorize']>;

type LoadResourcesIn<T extends HasLoadResources<any, any>> = Parameters<
  T['loadResources']
>[0];
type LoadResourcesReturn<T extends HasLoadResources<any, any>> =
  PromiseResolveOrSync<ReturnType<T['loadResources']>>;

type FinalAuthorizeContextIn<T extends HasFinalAuthorize<any, any>> =
  Parameters<T['finalAuthorize']>[0];
type FinalAuthorizeReturn<T extends HasFinalAuthorize<any, any>> =
  PromiseResolveOrSync<ReturnType<T['finalAuthorize']>>;
type FinalAuthorizeContextOut<T extends HasFinalAuthorize<any, any>> = object &
  PromiseResolveOrSync<ReturnType<T['finalAuthorize']>>;
type FinalAuthorizeContextOutFalseCase<T extends HasFinalAuthorize<any, any>> =
  false & PromiseResolveOrSync<ReturnType<T['finalAuthorize']>>;

type ExecuteContextIn<T extends HasExecute<any, any>> = Parameters<
  T['execute']
>[0];
type ExecuteReturn<T extends HasExecute<any, any>> = PromiseResolveOrSync<
  ReturnType<T['execute']>
>;

type RedactResponseContextIn<T extends HasRedactResponse<any, any>> =
  Parameters<T['redactResponse']>[0];
type RedactResponseReturn<T extends HasRedactResponse<any, any>> = ReturnType<
  T['redactResponse']
>;

// @note must wrap types with arrays to avoid distribution over naked type conditionals blowing up exponentially - see
// https://github.com/Microsoft/TypeScript/issues/29368#issuecomment-453529532
type PipedExtractAmbient<TLeft, TRight> = [TLeft] extends [
  HasExtractAmbient<any, any>,
]
  ? [TRight] extends [HasExtractAmbient<any, any>]
    ? HasExtractAmbient<
        ExtractAmbientIn<TLeft> &
          Omit<ExtractAmbientIn<TRight>, keyof ExtractAmbientReturn<TLeft>>,
        ExtractAmbientReturn<TRight> &
          Omit<ExtractAmbientReturn<TLeft>, keyof ExtractAmbientReturn<TRight>>
      >
    : { extractAmbient: TLeft['extractAmbient'] }
  : [TRight] extends [HasExtractAmbient<any, any>]
    ? { extractAmbient: TRight['extractAmbient'] }
    : {};

type PipedExtractInputs<TLeft, TRight> = [TLeft] extends [
  HasExtractInputs<any, any>,
]
  ? [TRight] extends [HasExtractInputs<any, any>]
    ? HasExtractInputs<
        ExtractInputsContextIn<TLeft> &
          Omit<
            ExtractInputsContextIn<TRight>,
            keyof ExtractInputsReturn<TLeft>
          >,
        ExtractInputsReturn<TRight> &
          Omit<ExtractInputsReturn<TLeft>, keyof ExtractInputsReturn<TRight>>
      >
    : { extractInputs: TLeft['extractInputs'] }
  : [TRight] extends [HasExtractInputs<any, any>]
    ? { extractInputs: TRight['extractInputs'] }
    : {};

// Strips index signatures, keeping only statically-known keys, so merging a
// legacy `X & Record<string, any>`-shaped return can't omit everything.
type KnownKeys<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K];
};

// Sanitize stages CHAIN (the right one consumes the left one's output), so the
// composed return type depends on the right fragment's style:
// - slice style (carries the UNSAFE_SLICES raw-remainder channel, i.e.
//   SanitizeInputsSlices): the left fragment's named slices survive — merge
//   them in (right wins on clashes).
// - full-replace style (no UNSAFE_SLICES key): the right return describes the
//   entire output; the left's keys are gone.
type ChainedSanitizeReturn<TLeftReturn, TRightReturn> =
  typeof UNSAFE_SLICES extends keyof TRightReturn
    ? TRightReturn &
        Omit<
          KnownKeys<Omit<TLeftReturn, typeof UNSAFE_SLICES>>,
          keyof KnownKeys<TRightReturn>
        >
    : TRightReturn;

type PipedSanitizeInputs<TLeft, TRight> = [TLeft] extends [
  HasSanitizeInputs<any, any>,
]
  ? [TRight] extends [HasSanitizeInputs<any, any>]
    ? HasSanitizeInputs<
        SanitizeInputsContextIn<TLeft>,
        ChainedSanitizeReturn<
          SanitizeInputsReturn<TLeft>,
          SanitizeInputsReturn<TRight>
        >
      >
    : { sanitizeInputs: TLeft['sanitizeInputs'] }
  : [TRight] extends [HasSanitizeInputs<any, any>]
    ? { sanitizeInputs: TRight['sanitizeInputs'] }
    : {};

type PipedPreAuthorize<TLeft, TRight> = [TLeft] extends [
  HasPreAuthorize<any, any>,
]
  ? [TRight] extends [HasPreAuthorize<any, any>]
    ? HasPreAuthorize<
        PreAuthorizeContextIn<TLeft> &
          Omit<
            PreAuthorizeContextIn<TRight>,
            PreAuthorizeReturn<TLeft> extends boolean
              ? keyof {}
              : keyof PreAuthorizeReturn<TLeft>
          >,
        PreAuthorizeReturn<TLeft> extends boolean
          ? PreAuthorizeReturn<TRight> extends boolean
            ? boolean
            :
                | PreAuthorizeContextOut<TRight>
                | (PreAuthorizeContextOutFalseCase<TLeft> & false)
                | (PreAuthorizeContextOutFalseCase<TRight> & false)
          : PreAuthorizeReturn<TRight> extends boolean
            ?
                | PreAuthorizeContextOut<TLeft>
                | (PreAuthorizeContextOutFalseCase<TLeft> & false)
                | (PreAuthorizeContextOutFalseCase<TRight> & false)
            :
                | (PreAuthorizeContextOut<TRight> &
                    Omit<
                      PreAuthorizeContextOut<TLeft>,
                      keyof PreAuthorizeContextOut<TRight>
                    >)
                | (PreAuthorizeContextOutFalseCase<TLeft> & false)
                | (PreAuthorizeContextOutFalseCase<TRight> & false)
      >
    : { preAuthorize: TLeft['preAuthorize'] }
  : [TRight] extends [HasPreAuthorize<any, any>]
    ? { preAuthorize: TRight['preAuthorize'] }
    : {};

type PipedLoadResources<TLeft, TRight> = [TLeft] extends [
  HasLoadResources<any, any>,
]
  ? [TRight] extends [HasLoadResources<any, any>]
    ? HasLoadResources<
        LoadResourcesIn<TLeft> &
          Omit<LoadResourcesIn<TRight>, keyof LoadResourcesReturn<TLeft>>,
        LoadResourcesReturn<TRight> &
          Omit<LoadResourcesReturn<TLeft>, keyof LoadResourcesReturn<TRight>>
      >
    : { loadResources: TLeft['loadResources'] }
  : [TRight] extends [HasLoadResources<any, any>]
    ? { loadResources: TRight['loadResources'] }
    : {};

type PipedFinalAuthorize<TLeft, TRight> = [TLeft] extends [
  HasFinalAuthorize<any, any>,
]
  ? [TRight] extends [HasFinalAuthorize<any, any>]
    ? HasFinalAuthorize<
        FinalAuthorizeContextIn<TLeft> &
          Omit<
            FinalAuthorizeContextIn<TRight>,
            FinalAuthorizeReturn<TLeft> extends boolean
              ? keyof {}
              : keyof FinalAuthorizeReturn<TLeft>
          >,
        FinalAuthorizeReturn<TLeft> extends boolean
          ? FinalAuthorizeReturn<TRight> extends boolean
            ? boolean
            :
                | FinalAuthorizeContextOut<TRight>
                | (FinalAuthorizeContextOutFalseCase<TLeft> & false)
                | (FinalAuthorizeContextOutFalseCase<TRight> & false)
          : FinalAuthorizeReturn<TRight> extends boolean
            ?
                | FinalAuthorizeContextOut<TLeft>
                | (FinalAuthorizeContextOutFalseCase<TLeft> & false)
                | (FinalAuthorizeContextOutFalseCase<TRight> & false)
            :
                | (FinalAuthorizeContextOut<TRight> &
                    Omit<
                      FinalAuthorizeContextOut<TLeft>,
                      keyof FinalAuthorizeContextOut<TRight>
                    >)
                | (FinalAuthorizeContextOutFalseCase<TLeft> & false)
                | (FinalAuthorizeContextOutFalseCase<TRight> & false)
      >
    : { finalAuthorize: TLeft['finalAuthorize'] }
  : [TRight] extends [HasFinalAuthorize<any, any>]
    ? { finalAuthorize: TRight['finalAuthorize'] }
    : {};

type PipedExecute<TLeft, TRight> = [TLeft] extends [HasExecute<any, any>]
  ? [TRight] extends [HasExecute<any, any>]
    ? HasExecute<ExecuteContextIn<TLeft>, ExecuteReturn<TRight>>
    : { execute: TLeft['execute'] }
  : [TRight] extends [HasExecute<any, any>]
    ? { execute: TRight['execute'] }
    : {};

type PipedRedactResponse<TLeft, TRight> = [TLeft] extends [
  HasRedactResponse<any, any>,
]
  ? [TRight] extends [HasRedactResponse<any, any>]
    ? HasRedactResponse<
        RedactResponseContextIn<TLeft>,
        RedactResponseReturn<TRight>
      >
    : { redactResponse: TLeft['redactResponse'] }
  : [TRight] extends [HasRedactResponse<any, any>]
    ? { redactResponse: TRight['redactResponse'] }
    : {};

type ClashlessExtractAmbient<TLeft, TRight> = OptionallyHasExtractAmbient<
  any,
  TRight extends HasExtractAmbient<any, any>
    ? Pick<
        Parameters<TRight['extractAmbient']>[0],
        keyof ReturnType<
          TLeft extends HasExtractAmbient<any, any>
            ? TLeft['extractAmbient']
            : () => {}
        >
      >
    : any
>;

type ClashlessExtractInputs<TLeft, TRight> = OptionallyHasExtractInputs<
  any,
  TRight extends HasExtractInputs<any, any>
    ? Pick<
        Parameters<TRight['extractInputs']>[0],
        keyof ReturnType<
          TLeft extends HasExtractInputs<any, any>
            ? TLeft['extractInputs']
            : () => {}
        >
      >
    : any
>;

type ClashlessSanitizeInputs<_TLeft, TRight> = OptionallyHasSanitizeInputs<
  any,
  TRight extends HasSanitizeInputs<any, any>
    ? Parameters<TRight['sanitizeInputs']>[0]
    : any
>;

type ClashlessPreAuthorize<TLeft, TRight> = OptionallyHasPreAuthorize<
  any,
  | boolean
  | (TRight extends HasPreAuthorize<any, any>
      ? Pick<
          Parameters<TRight['preAuthorize']>[0],
          keyof ReturnType<
            TLeft extends HasPreAuthorize<any, any>
              ? TLeft['preAuthorize']
              : () => {}
          >
        >
      : any)
>;

type ClashlessLoadResources<TLeft, TRight> = OptionallyHasLoadResources<
  any,
  TRight extends HasLoadResources<any, any>
    ? Pick<
        Parameters<TRight['loadResources']>[0],
        keyof PromiseResolveOrSync<
          ReturnType<
            TLeft extends HasLoadResources<any, any>
              ? TLeft['loadResources']
              : () => {}
          >
        >
      >
    : any
>;

type ClashlessFinalAuthorize<TLeft, TRight> = OptionallyHasFinalAuthorize<
  any,
  | boolean
  | (TRight extends HasFinalAuthorize<any, any>
      ? Pick<
          Parameters<TRight['finalAuthorize']>[0],
          keyof PromiseResolveOrSync<
            ReturnType<
              TLeft extends HasFinalAuthorize<any, any>
                ? TLeft['finalAuthorize']
                : () => {}
            >
          >
        >
      : any)
>;

type ClashlessExecute<_TLeft, TRight> = OptionallyHasExecute<
  any,
  TRight extends HasExecute<any, any> ? Parameters<TRight['execute']>[0] : any
>;

type ClashlessRedactResponse<_TLeft, TRight> = OptionallyHasRedactResponse<
  any,
  TRight extends HasRedactResponse<any, any>
    ? Parameters<TRight['redactResponse']>[0]
    : any
>;

// Non-stage keys (e.g. the HTTP adapters' `responseMeta`) pass through HTPipe
// untouched with right-wins semantics, so adapter-level configuration can live
// on any fragment. Core stays ignorant of what the keys mean.
type NonStageKeys<T> = Omit<KnownKeys<T>, AllStageKeys>;
type PipedPassthrough<TLeft, TRight> = NonStageKeys<TRight> &
  Omit<NonStageKeys<TLeft>, keyof NonStageKeys<TRight>>;

// Flat variant for the 5+-arity overloads: folds right-wins passthrough over
// the raw fragment tuple (first fragment = leftmost = lowest precedence).
// Operating on plain fragments instead of nested PipedAll folds keeps the
// mapped-type instantiation cost linear.
type PipedPassthroughAll<Ts extends readonly any[]> = Ts extends [
  infer THead,
  ...infer TRest,
]
  ? TRest extends []
    ? NonStageKeys<THead>
    : PipedPassthrough<THead, PipedPassthroughAll<TRest>>
  : {};

const ALL_STAGE_KEYS: AllStageKeys[] = [
  'extractAmbient',
  'extractInputs',
  'sanitizeInputs',
  'preAuthorize',
  'loadResources',
  'finalAuthorize',
  'execute',
  'redactResponse',
];

// Compact aliases for the higher arities: the intersection composes the same
// way per-stage folds do, because each PipedX contributes a disjoint key.
type PipedAll<TLeft, TRight> = PipedExtractAmbient<TLeft, TRight> &
  PipedExtractInputs<TLeft, TRight> &
  PipedSanitizeInputs<TLeft, TRight> &
  PipedPreAuthorize<TLeft, TRight> &
  PipedLoadResources<TLeft, TRight> &
  PipedFinalAuthorize<TLeft, TRight> &
  PipedExecute<TLeft, TRight> &
  PipedRedactResponse<TLeft, TRight>;

function nonStageKeysOf(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (!(ALL_STAGE_KEYS as string[]).includes(key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

// no parameter - returns empty object
export function HTPipe(): {};

// one parameter - returns a new object with all the valid lifecycle stages of the parameter
export function HTPipe<
  T extends OptionallyHasExtractAmbient<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    OptionallyHasPreAuthorize<any, any> &
    OptionallyHasLoadResources<any, any> &
    OptionallyHasFinalAuthorize<any, any> &
    OptionallyHasExecute<any, any> &
    OptionallyHasRedactResponse<any, any>,
>(obj: T): Pick<T, AllStageKeys> & NonStageKeys<T>;

// two parameters with automatic type guessing of right - all or nothing!
export function HTPipe<
  TLeft extends OptionallyHasExtractAmbient<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    OptionallyHasPreAuthorize<any, any> &
    OptionallyHasLoadResources<any, any> &
    OptionallyHasFinalAuthorize<any, any> &
    OptionallyHasExecute<any, any> &
    OptionallyHasRedactResponse<any, any>,
  TRight extends (TLeft extends HasExtractAmbient<any, any>
    ? OptionallyHasExtractAmbient<ReturnType<TLeft['extractAmbient']>, any>
    : {}) &
    (TLeft extends HasExtractInputs<any, any>
      ? OptionallyHasExtractInputs<ReturnType<TLeft['extractInputs']>, any>
      : {}) &
    (TLeft extends HasSanitizeInputs<any, any>
      ? OptionallyHasSanitizeInputs<ReturnType<TLeft['sanitizeInputs']>, any>
      : {}) &
    (TLeft extends HasPreAuthorize<any, any>
      ? OptionallyHasPreAuthorize<ReturnType<TLeft['preAuthorize']>, any>
      : {}) &
    (TLeft extends HasLoadResources<any, any>
      ? OptionallyHasLoadResources<
          PromiseResolveOrSync<ReturnType<TLeft['loadResources']>>,
          any
        >
      : {}) &
    (TLeft extends HasFinalAuthorize<any, any>
      ? OptionallyHasFinalAuthorize<
          PromiseResolveOrSync<ReturnType<TLeft['finalAuthorize']>>,
          any
        >
      : {}) &
    (TLeft extends HasExecute<any, any>
      ? OptionallyHasExecute<
          PromiseResolveOrSync<ReturnType<TLeft['execute']>>,
          any
        >
      : {}) &
    (TLeft extends HasRedactResponse<any, any>
      ? OptionallyHasRedactResponse<ReturnType<TLeft['redactResponse']>, any>
      : {}),
>(
  left: TLeft,
  right: TRight
): PipedExtractAmbient<TLeft, TRight> &
  PipedExtractInputs<TLeft, TRight> &
  PipedSanitizeInputs<TLeft, TRight> &
  PipedPreAuthorize<TLeft, TRight> &
  PipedLoadResources<TLeft, TRight> &
  PipedFinalAuthorize<TLeft, TRight> &
  PipedExecute<TLeft, TRight> &
  PipedRedactResponse<TLeft, TRight> &
  PipedPassthrough<TLeft, TRight>;

// two parameters with possibly added inputs
export function HTPipe<
  TLeft extends ClashlessExtractAmbient<TLeft, TRight> &
    ClashlessExtractInputs<TLeft, TRight> &
    ClashlessSanitizeInputs<TLeft, TRight> &
    ClashlessPreAuthorize<TLeft, TRight> &
    ClashlessLoadResources<TLeft, TRight> &
    ClashlessFinalAuthorize<TLeft, TRight> &
    ClashlessExecute<TLeft, TRight> &
    ClashlessRedactResponse<TLeft, TRight>,
  TRight extends OptionallyHasExtractAmbient<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    OptionallyHasPreAuthorize<any, any> &
    OptionallyHasLoadResources<any, any> &
    OptionallyHasFinalAuthorize<any, any> &
    OptionallyHasExecute<any, any> &
    OptionallyHasRedactResponse<any, any>,
>(
  left: TLeft,
  right: TRight
): PipedExtractAmbient<TLeft, TRight> &
  PipedExtractInputs<TLeft, TRight> &
  PipedSanitizeInputs<TLeft, TRight> &
  PipedPreAuthorize<TLeft, TRight> &
  PipedLoadResources<TLeft, TRight> &
  PipedFinalAuthorize<TLeft, TRight> &
  PipedExecute<TLeft, TRight> &
  PipedRedactResponse<TLeft, TRight> &
  PipedPassthrough<TLeft, TRight>;

// three parameters with possibly added inputs
export function HTPipe<
  T3 extends ClashlessExtractAmbient<T3, PipedExtractAmbient<T2, T1>> &
    ClashlessExtractInputs<T3, PipedExtractInputs<T2, T1>> &
    ClashlessSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>> &
    ClashlessPreAuthorize<T3, PipedPreAuthorize<T2, T1>> &
    ClashlessLoadResources<T3, PipedLoadResources<T2, T1>> &
    ClashlessFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>> &
    ClashlessExecute<T3, PipedExecute<T2, T1>> &
    ClashlessRedactResponse<T3, PipedRedactResponse<T2, T1>>,
  T2 extends ClashlessExtractAmbient<T2, T1> &
    ClashlessExtractInputs<T2, T1> &
    ClashlessSanitizeInputs<T2, T1> &
    ClashlessPreAuthorize<T2, T1> &
    ClashlessLoadResources<T2, T1> &
    ClashlessFinalAuthorize<T2, T1> &
    ClashlessExecute<T2, T1> &
    ClashlessRedactResponse<T2, T1>,
  T1 extends OptionallyHasExtractAmbient<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    OptionallyHasPreAuthorize<any, any> &
    OptionallyHasLoadResources<any, any> &
    OptionallyHasFinalAuthorize<any, any> &
    OptionallyHasExecute<any, any> &
    OptionallyHasRedactResponse<any, any>,
>(
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedExtractAmbient<T3, PipedExtractAmbient<T2, T1>> &
  PipedExtractInputs<T3, PipedExtractInputs<T2, T1>> &
  PipedSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>> &
  PipedPreAuthorize<T3, PipedPreAuthorize<T2, T1>> &
  PipedLoadResources<T3, PipedLoadResources<T2, T1>> &
  PipedFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>> &
  PipedExecute<T3, PipedExecute<T2, T1>> &
  PipedRedactResponse<T3, PipedRedactResponse<T2, T1>> &
  PipedPassthrough<T3, PipedPassthrough<T2, T1>>;

// four parameters with possibly added inputs
export function HTPipe<
  T4 extends ClashlessExtractAmbient<
    T4,
    PipedExtractAmbient<T3, PipedExtractAmbient<T2, T1>>
  > &
    ClashlessExtractInputs<
      T4,
      PipedExtractInputs<T3, PipedExtractInputs<T2, T1>>
    > &
    ClashlessSanitizeInputs<
      T4,
      PipedSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>>
    > &
    ClashlessPreAuthorize<
      T4,
      PipedPreAuthorize<T3, PipedPreAuthorize<T2, T1>>
    > &
    ClashlessLoadResources<
      T4,
      PipedLoadResources<T3, PipedLoadResources<T2, T1>>
    > &
    ClashlessFinalAuthorize<
      T4,
      PipedFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>>
    > &
    ClashlessExecute<T4, PipedExecute<T3, PipedExecute<T2, T1>>> &
    ClashlessRedactResponse<
      T4,
      PipedRedactResponse<T3, PipedRedactResponse<T2, T1>>
    >,
  T3 extends ClashlessExtractAmbient<T3, PipedExtractAmbient<T2, T1>> &
    ClashlessExtractInputs<T3, PipedExtractInputs<T2, T1>> &
    ClashlessSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>> &
    ClashlessPreAuthorize<T3, PipedPreAuthorize<T2, T1>> &
    ClashlessLoadResources<T3, PipedLoadResources<T2, T1>> &
    ClashlessFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>> &
    ClashlessExecute<T3, PipedExecute<T2, T1>> &
    ClashlessRedactResponse<T3, PipedRedactResponse<T2, T1>>,
  T2 extends ClashlessExtractAmbient<T2, T1> &
    ClashlessExtractInputs<T2, T1> &
    ClashlessSanitizeInputs<T2, T1> &
    ClashlessPreAuthorize<T2, T1> &
    ClashlessLoadResources<T2, T1> &
    ClashlessFinalAuthorize<T2, T1> &
    ClashlessExecute<T2, T1> &
    ClashlessRedactResponse<T2, T1>,
  T1 extends OptionallyHasExtractAmbient<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    OptionallyHasPreAuthorize<any, any> &
    OptionallyHasLoadResources<any, any> &
    OptionallyHasFinalAuthorize<any, any> &
    OptionallyHasExecute<any, any> &
    OptionallyHasRedactResponse<any, any>,
>(
  obj4: T4,
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedExtractAmbient<
  T4,
  PipedExtractAmbient<T3, PipedExtractAmbient<T2, T1>>
> &
  PipedExtractInputs<T4, PipedExtractInputs<T3, PipedExtractInputs<T2, T1>>> &
  PipedSanitizeInputs<
    T4,
    PipedSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>>
  > &
  PipedPreAuthorize<T4, PipedPreAuthorize<T3, PipedPreAuthorize<T2, T1>>> &
  PipedLoadResources<T4, PipedLoadResources<T3, PipedLoadResources<T2, T1>>> &
  PipedFinalAuthorize<
    T4,
    PipedFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>>
  > &
  PipedExecute<T4, PipedExecute<T3, PipedExecute<T2, T1>>> &
  PipedRedactResponse<
    T4,
    PipedRedactResponse<T3, PipedRedactResponse<T2, T1>>
  > &
  PipedPassthrough<T4, PipedPassthrough<T3, PipedPassthrough<T2, T1>>>;

// five parameters with possibly added inputs
export function HTPipe<
  T5 extends AllStagesOptionalShape,
  T4 extends AllStagesOptionalShape,
  T3 extends AllStagesOptionalShape,
  T2 extends AllStagesOptionalShape,
  T1 extends AllStagesOptionalShape,
>(
  obj5: T5,
  obj4: T4,
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedAll<T5, PipedAll<T4, PipedAll<T3, PipedAll<T2, T1>>>> &
  PipedPassthroughAll<[T5, T4, T3, T2, T1]>;

// six parameters with possibly added inputs
export function HTPipe<
  T6 extends AllStagesOptionalShape,
  T5 extends AllStagesOptionalShape,
  T4 extends AllStagesOptionalShape,
  T3 extends AllStagesOptionalShape,
  T2 extends AllStagesOptionalShape,
  T1 extends AllStagesOptionalShape,
>(
  obj6: T6,
  obj5: T5,
  obj4: T4,
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedAll<T6, PipedAll<T5, PipedAll<T4, PipedAll<T3, PipedAll<T2, T1>>>>> &
  PipedPassthroughAll<[T6, T5, T4, T3, T2, T1]>;

// seven parameters with possibly added inputs
export function HTPipe<
  T7 extends AllStagesOptionalShape,
  T6 extends AllStagesOptionalShape,
  T5 extends AllStagesOptionalShape,
  T4 extends AllStagesOptionalShape,
  T3 extends AllStagesOptionalShape,
  T2 extends AllStagesOptionalShape,
  T1 extends AllStagesOptionalShape,
>(
  obj7: T7,
  obj6: T6,
  obj5: T5,
  obj4: T4,
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedAll<
  T7,
  PipedAll<T6, PipedAll<T5, PipedAll<T4, PipedAll<T3, PipedAll<T2, T1>>>>>
> &
  PipedPassthroughAll<[T7, T6, T5, T4, T3, T2, T1]>;

// eight parameters with possibly added inputs
export function HTPipe<
  T8 extends AllStagesOptionalShape,
  T7 extends AllStagesOptionalShape,
  T6 extends AllStagesOptionalShape,
  T5 extends AllStagesOptionalShape,
  T4 extends AllStagesOptionalShape,
  T3 extends AllStagesOptionalShape,
  T2 extends AllStagesOptionalShape,
  T1 extends AllStagesOptionalShape,
>(
  obj8: T8,
  obj7: T7,
  obj6: T6,
  obj5: T5,
  obj4: T4,
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedAll<
  T8,
  PipedAll<
    T7,
    PipedAll<T6, PipedAll<T5, PipedAll<T4, PipedAll<T3, PipedAll<T2, T1>>>>>
  >
> &
  PipedPassthroughAll<[T8, T7, T6, T5, T4, T3, T2, T1]>;

export function HTPipe(...objs: any[]) {
  if (objs.length === 0) {
    return {};
  }
  if (objs.length === 1) {
    return HTPipe(objs[0], {});
  }
  if (objs.length === 2) {
    const left = objs[0];
    const right = objs[1];
    return {
      // Non-stage keys (adapter config like responseMeta) pass through,
      // right-wins. Stage keys are rebuilt below and never leak through here.
      ...nonStageKeysOf(left),
      ...nonStageKeysOf(right),
      ...((isHasExtractAmbient(left) && isHasExtractAmbient(right)
        ? {
            extractAmbient: (context: any) => {
              const leftOut = left.extractAmbient(context) || {};
              const rightIn = {
                ...context,
                ...(leftOut as {}),
              };
              const rightOut = right.extractAmbient(rightIn) || {};
              return {
                ...(leftOut as {}),
                ...(rightOut as {}),
              };
            },
          }
        : isHasExtractAmbient(left)
          ? { extractAmbient: left.extractAmbient }
          : isHasExtractAmbient(right)
            ? { extractAmbient: right.extractAmbient }
            : {}) as PipedExtractAmbient<any, any>),
      ...((isHasExtractInputs(left) && isHasExtractInputs(right)
        ? {
            extractInputs: (context: any) => {
              const leftOut = left.extractInputs(context) || {};
              const rightIn = {
                ...context,
                ...(leftOut as {}),
              };
              const rightOut = right.extractInputs(rightIn) || {};
              return {
                ...(leftOut as {}),
                ...(rightOut as {}),
              };
            },
          }
        : isHasExtractInputs(left)
          ? { extractInputs: left.extractInputs }
          : isHasExtractInputs(right)
            ? { extractInputs: right.extractInputs }
            : {}) as PipedExtractInputs<any, any>),
      ...((isHasSanitizeInputs(left) && isHasSanitizeInputs(right)
        ? {
            sanitizeInputs: (context: any) => {
              const leftOut = left.sanitizeInputs(context) || {};
              const rightIn = leftOut;
              const rightOut = right.sanitizeInputs(rightIn) || {};
              return rightOut as {};
            },
          }
        : isHasSanitizeInputs(left)
          ? { sanitizeInputs: left.sanitizeInputs }
          : isHasSanitizeInputs(right)
            ? { sanitizeInputs: right.sanitizeInputs }
            : {}) as PipedSanitizeInputs<any, any>),
      ...((isHasPreAuthorize(left) && isHasPreAuthorize(right)
        ? {
            preAuthorize: (context: any) => {
              const leftOut = left.preAuthorize(context);
              const leftPassed = authorizationPassed(
                leftOut as boolean | object
              );
              if (!leftPassed) {
                return false;
              }
              const leftContextOut =
                leftOut === true ? {} : (leftOut as object);
              const rightIn = {
                ...context,
                ...leftContextOut,
              };
              const rightOut = right.preAuthorize(rightIn);
              const rightPassed = authorizationPassed(
                rightOut as boolean | object
              );
              if (!rightPassed) {
                return false;
              }
              if (leftOut === true && rightOut === true) {
                return true;
              }
              const rightContextOut =
                rightOut === true ? {} : (rightOut as object);
              return {
                ...leftContextOut,
                ...rightContextOut,
              };
            },
          }
        : isHasPreAuthorize(left)
          ? { preAuthorize: left.preAuthorize }
          : isHasPreAuthorize(right)
            ? { preAuthorize: right.preAuthorize }
            : {}) as PipedPreAuthorize<any, any>),
      ...((isHasLoadResources(left) && isHasLoadResources(right)
        ? {
            loadResources: async (context: any) => {
              const leftOut =
                (await Promise.resolve(left.loadResources(context))) || {};
              const rightIn = {
                ...context,
                ...(leftOut as {}),
              };
              const rightOut =
                (await Promise.resolve(right.loadResources(rightIn))) || {};
              return {
                ...(leftOut as {}),
                ...(rightOut as {}),
              };
            },
          }
        : isHasLoadResources(left)
          ? { loadResources: left.loadResources }
          : isHasLoadResources(right)
            ? { loadResources: right.loadResources }
            : {}) as PipedLoadResources<any, any>),
      ...((isHasFinalAuthorize(left) && isHasFinalAuthorize(right)
        ? {
            finalAuthorize: async (context: any) => {
              const leftOut = await Promise.resolve(
                left.finalAuthorize(context)
              );
              const leftPassed = authorizationPassed(
                leftOut as boolean | object
              );
              if (!leftPassed) {
                return false;
              }
              const leftContextOut =
                leftOut === true ? {} : (leftOut as object);
              const rightIn = {
                ...context,
                ...leftContextOut,
              };
              const rightOut = await Promise.resolve(
                right.finalAuthorize(rightIn)
              );
              const rightPassed = authorizationPassed(
                rightOut as boolean | object
              );
              if (!rightPassed) {
                return false;
              }
              if (leftOut === true && rightOut === true) {
                return true;
              }
              const rightContextOut =
                rightOut === true ? {} : (rightOut as object);
              return {
                ...leftContextOut,
                ...rightContextOut,
              };
            },
          }
        : isHasFinalAuthorize(left)
          ? { finalAuthorize: left.finalAuthorize }
          : isHasFinalAuthorize(right)
            ? { finalAuthorize: right.finalAuthorize }
            : {}) as PipedFinalAuthorize<any, any>),
      ...((isHasExecute(left) && isHasExecute(right)
        ? {
            execute: async (context: any) => {
              await Promise.resolve(left.execute(context));
              return await Promise.resolve(right.execute(context));
            },
          }
        : isHasExecute(left)
          ? { execute: left.execute }
          : isHasExecute(right)
            ? { execute: right.execute }
            : {}) as PipedExecute<any, any>),
      ...((isHasRedactResponse(left) && isHasRedactResponse(right)
        ? {
            redactResponse: (unsafeResponse: any, context: any) => {
              const leftOut =
                left.redactResponse(unsafeResponse, context) || {};
              const rightOut = right.redactResponse(leftOut, context) || {};
              return rightOut;
            },
          }
        : isHasRedactResponse(left)
          ? { redactResponse: left.redactResponse }
          : isHasRedactResponse(right)
            ? { redactResponse: right.redactResponse }
            : {}) as PipedRedactResponse<any, any>),
    };
  }

  return objs.reduce((prev: any, curr: any) => HTPipe(prev, curr), {});
}

export { UNSAFE_SLICES } from './types.js';
export type { HasUnsafeSlices, SanitizedOnly } from './types.js';
export * from './core.js';
export * from './errors.js';
export * from './http-adapter.js';
export * from './user.js';
export * from './lifecycle-functions.js';
