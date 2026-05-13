import {
  authorizationPassed,
  isHasAttachData,
  isHasDoWork,
  isHasExtractInputs,
  isHasFinalAuthorize,
  isHasInitPreContext,
  isHasPreAuthorize,
  isHasSanitizeInputs,
  isHasSanitizeResponse,
} from './core';
import {
  AttachData,
  DoWork,
  ExtractInputs,
  FinalAuthorize,
  InitPreContext,
  PreAuthorize,
  SanitizeInputs,
  SanitizeResponse,
} from './lifecycle-functions';
import {
  AllStageKeys,
  HasAllNotRequireds,
  HasAllRequireds,
  HasAttachData,
  HasDoWork,
  HasExtractInputs,
  HasFinalAuthorize,
  HasInitPreContext,
  HasPreAuthorize,
  HasSanitizeInputs,
  HasSanitizeResponse,
  MightHaveFinalAuthorize,
  MightHavePreAuthorize,
  MightHaveSanitizeResponse,
  OptionallyHasAttachData,
  OptionallyHasDoWork,
  OptionallyHasExtractInputs,
  OptionallyHasInitPreContext,
  OptionallyHasSanitizeInputs,
  PromiseResolveOrSync,
} from './types';

type FunctionTaking<TIn> = (param: TIn) => any;

type HasTypedFunctionOn<T, K extends string> = Record<K, FunctionTaking<T>>;

export function fromWrappedInstanceMethod<
  TIn,
  TOut extends ReturnType<TInstance[TMethodName]>,
  TInstance extends HasTypedFunctionOn<TIn, TMethodName>,
  TMethodName extends string
>(instanceMethodName: TMethodName) {
  // tslint:disable-next-line:only-arrow-functions
  return function(instance: TInstance) {
    // tslint:disable-next-line:only-arrow-functions
    return Promise.resolve(function(arg: TIn): Promise<TOut> {
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

export function InitPreContextFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return InitPreContext((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function InitPreContextTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return InitPreContext((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx) };
  });
}

export function InitPreContextFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return InitPreContext((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx[whereToLook]) };
  });
}

export function ExtractInputsFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return ExtractInputs((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function ExtractInputsTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return ExtractInputs((htCtx: TContextIn) => {
    return { [whereToStore]: projector(htCtx) };
  });
}

export function ExtractInputsFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object
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
  TContextOut extends object
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return SanitizeInputs((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function SanitizeInputsTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object
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
  TContextOut extends object
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

// Per-slot composer: writes to sanitizeInputs under a chosen key, preserving any other
// slices already present. This restores per-slot ergonomics on top of the single-slot core.
// Example: WithInputSlice('params', IdSchema.parse) becomes the new WithParamsSanitized.
// Input type is intentionally loose (Record<string, any>) so multiple WithInputSlice mixins
// can chain freely; the sanitizer enforces the slice's own runtime shape.
export function WithInputSlice<
  TSliceName extends string,
  TUnsafeSlice,
  TSafeSlice
>(sliceName: TSliceName, sanitizer: (unsafeSlice: TUnsafeSlice) => TSafeSlice) {
  return SanitizeInputs((unsafeInputs: Record<string, any>): {
    [K in TSliceName]: TSafeSlice;
  } &
    Record<string, any> => {
    return {
      ...unsafeInputs,
      [sliceName]: sanitizer(unsafeInputs[sliceName] as TUnsafeSlice),
    } as { [K in TSliceName]: TSafeSlice } & Record<string, any>;
  });
}

export function PreAuthorizeFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object | boolean
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return PreAuthorize((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function PreAuthorizeTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object | boolean
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
  TContextOut extends object | boolean
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

export function AttachDataFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends PromiseResolveOrSync<object>
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return AttachData((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function AttachDataTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return AttachData(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx)),
    };
  });
}

export function AttachDataFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends object
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return AttachData(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx[whereToLook])),
    };
  });
}

export function FinalAuthorizeFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut extends PromiseResolveOrSync<object | boolean>
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return FinalAuthorize((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function FinalAuthorizeTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TContextOut extends PromiseResolveOrSync<object | boolean>
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
  TContextOut extends PromiseResolveOrSync<object | boolean>
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

export function DoWorkFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TUnsafeResponse
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TUnsafeResponse
) {
  return DoWork((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function DoWorkTo<
  TWhereToStore extends string,
  TContextIn extends object,
  TUnsafeResponse
>(
  projector: (htCtx: TContextIn) => TUnsafeResponse,
  whereToStore: TWhereToStore
) {
  return DoWork(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx)),
    };
  });
}

export function DoWorkFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TUnsafeResponse
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TUnsafeResponse,
  whereToStore: TWhereToStore
) {
  return DoWork(async (htCtx: TContextIn) => {
    return {
      [whereToStore]: await Promise.resolve(projector(htCtx[whereToLook])),
    };
  });
}

export function SanitizeResponseFrom<
  TWhereToLook extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut
) {
  return SanitizeResponse((htCtx: TContextIn) => projector(htCtx[whereToLook]));
}

export function SanitizeResponseTo<
  TWhereToStore extends string,
  TContextIn,
  TContextOut
>(projector: (htCtx: TContextIn) => TContextOut, whereToStore: TWhereToStore) {
  return SanitizeResponse((htCtx: TContextIn) => {
    return {
      [whereToStore]: projector(htCtx),
    };
  });
}

export function SanitizeResponseFromTo<
  TWhereToLook extends string,
  TWhereToStore extends string,
  TContextIn extends { [key in TWhereToLook]: TContextIn[TWhereToLook] },
  TContextOut
>(
  whereToLook: TWhereToLook,
  projector: (htCtx: TContextIn[TWhereToLook]) => TContextOut,
  whereToStore: TWhereToStore
) {
  return SanitizeResponse((htCtx: TContextIn) => {
    return {
      [whereToStore]: projector(htCtx[whereToLook]),
    };
  });
}

type InitPreContextIn<T extends HasInitPreContext<any, any>> = Parameters<
  T['initPreContext']
>[0];
type InitPreContextReturn<T extends HasInitPreContext<any, any>> = ReturnType<
  T['initPreContext']
>;

type ExtractInputsContextIn<T extends HasExtractInputs<any, any>> = Parameters<
  T['extractInputs']
>[0];
type ExtractInputsReturn<T extends HasExtractInputs<any, any>> = ReturnType<
  T['extractInputs']
>;

type SanitizeInputsContextIn<
  T extends HasSanitizeInputs<any, any>
> = Parameters<T['sanitizeInputs']>[0];
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
type PreAuthorizeContextOutFalseCase<
  T extends HasPreAuthorize<any, any>
> = false & ReturnType<T['preAuthorize']>;

type AttachDataIn<T extends HasAttachData<any, any>> = Parameters<
  T['attachData']
>[0];
type AttachDataReturn<T extends HasAttachData<any, any>> = PromiseResolveOrSync<
  ReturnType<T['attachData']>
>;

type FinalAuthorizeContextIn<
  T extends HasFinalAuthorize<any, any>
> = Parameters<T['finalAuthorize']>[0];
type FinalAuthorizeReturn<
  T extends HasFinalAuthorize<any, any>
> = PromiseResolveOrSync<ReturnType<T['finalAuthorize']>>;
type FinalAuthorizeContextOut<T extends HasFinalAuthorize<any, any>> = object &
  PromiseResolveOrSync<ReturnType<T['finalAuthorize']>>;
type FinalAuthorizeContextOutFalseCase<
  T extends HasFinalAuthorize<any, any>
> = false & PromiseResolveOrSync<ReturnType<T['finalAuthorize']>>;

type DoWorkContextIn<T extends HasDoWork<any, any>> = Parameters<
  T['doWork']
>[0];
type DoWorkReturn<T extends HasDoWork<any, any>> = PromiseResolveOrSync<
  ReturnType<T['doWork']>
>;

type SanitizeResponseContextIn<
  T extends HasSanitizeResponse<any, any>
> = Parameters<T['sanitizeResponse']>[0];
type SanitizeResponseReturn<
  T extends HasSanitizeResponse<any, any>
> = ReturnType<T['sanitizeResponse']>;

// @note must wrap types with arrays to avoid distribution over naked type conditionals blowing up exponentially - see
// https://github.com/Microsoft/TypeScript/issues/29368#issuecomment-453529532
type PipedPreContext<TLeft, TRight> = [TLeft] extends [
  HasInitPreContext<any, any>
]
  ? [TRight] extends [HasInitPreContext<any, any>]
    ? HasInitPreContext<
        InitPreContextIn<TLeft> &
          Omit<InitPreContextIn<TRight>, keyof InitPreContextReturn<TLeft>>,
        InitPreContextReturn<TRight> &
          Omit<InitPreContextReturn<TLeft>, keyof InitPreContextReturn<TRight>>
      >
    : { initPreContext: TLeft['initPreContext'] }
  : [TRight] extends [HasInitPreContext<any, any>]
  ? { initPreContext: TRight['initPreContext'] }
  : {};

type PipedExtractInputs<TLeft, TRight> = [TLeft] extends [
  HasExtractInputs<any, any>
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

type PipedSanitizeInputs<TLeft, TRight> = [TLeft] extends [
  HasSanitizeInputs<any, any>
]
  ? [TRight] extends [HasSanitizeInputs<any, any>]
    ? HasSanitizeInputs<
        SanitizeInputsContextIn<TLeft>,
        SanitizeInputsReturn<TRight>
      >
    : { sanitizeInputs: TLeft['sanitizeInputs'] }
  : [TRight] extends [HasSanitizeInputs<any, any>]
  ? { sanitizeInputs: TRight['sanitizeInputs'] }
  : {};

type PipedPreAuthorize<TLeft, TRight> = [TLeft] extends [
  HasPreAuthorize<any, any>
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

type PipedAttachData<TLeft, TRight> = [TLeft] extends [HasAttachData<any, any>]
  ? [TRight] extends [HasAttachData<any, any>]
    ? HasAttachData<
        AttachDataIn<TLeft> &
          Omit<AttachDataIn<TRight>, keyof AttachDataReturn<TLeft>>,
        AttachDataReturn<TRight> &
          Omit<AttachDataReturn<TLeft>, keyof AttachDataReturn<TRight>>
      >
    : { attachData: TLeft['attachData'] }
  : [TRight] extends [HasAttachData<any, any>]
  ? { attachData: TRight['attachData'] }
  : {};

type PipedFinalAuthorize<TLeft, TRight> = [TLeft] extends [
  HasFinalAuthorize<any, any>
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

type PipedDoWork<TLeft, TRight> = [TLeft] extends [HasDoWork<any, any>]
  ? [TRight] extends [HasDoWork<any, any>]
    ? HasDoWork<DoWorkContextIn<TLeft>, DoWorkReturn<TRight>>
    : { doWork: TLeft['doWork'] }
  : [TRight] extends [HasDoWork<any, any>]
  ? { doWork: TRight['doWork'] }
  : {};

type PipedSanitizeResponse<TLeft, TRight> = [TLeft] extends [
  HasSanitizeResponse<any, any>
]
  ? [TRight] extends [HasSanitizeResponse<any, any>]
    ? HasSanitizeResponse<
        SanitizeResponseContextIn<TLeft>,
        SanitizeResponseReturn<TRight>
      >
    : { sanitizeResponse: TLeft['sanitizeResponse'] }
  : [TRight] extends [HasSanitizeResponse<any, any>]
  ? { sanitizeResponse: TRight['sanitizeResponse'] }
  : {};

type ClashlessInitPreContext<TLeft, TRight> = OptionallyHasInitPreContext<
  any,
  TRight extends HasInitPreContext<any, any>
    ? Pick<
        Parameters<TRight['initPreContext']>[0],
        keyof ReturnType<
          TLeft extends HasInitPreContext<any, any>
            ? TLeft['initPreContext']
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

type ClashlessSanitizeInputs<TLeft, TRight> = OptionallyHasSanitizeInputs<
  any,
  TRight extends HasSanitizeInputs<any, any>
    ? Parameters<TRight['sanitizeInputs']>[0]
    : any
>;

type ClashlessPreAuthorize<TLeft, TRight> = MightHavePreAuthorize<
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

type ClashlessAttachData<TLeft, TRight> = OptionallyHasAttachData<
  any,
  TRight extends HasAttachData<any, any>
    ? Pick<
        Parameters<TRight['attachData']>[0],
        keyof PromiseResolveOrSync<
          ReturnType<
            TLeft extends HasAttachData<any, any>
              ? TLeft['attachData']
              : () => {}
          >
        >
      >
    : any
>;

type ClashlessFinalAuthorize<TLeft, TRight> = MightHaveFinalAuthorize<
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

type ClashlessDoWork<TLeft, TRight> = OptionallyHasDoWork<
  any,
  TRight extends HasDoWork<any, any> ? Parameters<TRight['doWork']>[0] : any
>;

type ClashlessSanitizeResponse<TLeft, TRight> = MightHaveSanitizeResponse<
  any,
  TRight extends HasSanitizeResponse<any, any>
    ? Parameters<TRight['sanitizeResponse']>[0]
    : any
>;

// no parameter - returns empty object
export function HTPipe(): {};

// one parameter - returns a new object with all the valid lifecycle stages of the parameter
export function HTPipe<
  T extends OptionallyHasInitPreContext<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    MightHavePreAuthorize<any, any> &
    OptionallyHasAttachData<any, any> &
    MightHaveFinalAuthorize<any, any> &
    OptionallyHasDoWork<any, any> &
    MightHaveSanitizeResponse<any, any>
>(obj: T): Pick<T, AllStageKeys>;

// two parameters with automatic type guessing of right - all or nothing!
export function HTPipe<
  TLeft extends OptionallyHasInitPreContext<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    MightHavePreAuthorize<any, any> &
    OptionallyHasAttachData<any, any> &
    MightHaveFinalAuthorize<any, any> &
    OptionallyHasDoWork<any, any> &
    MightHaveSanitizeResponse<any, any>,
  TRight extends (TLeft extends HasInitPreContext<any, any>
    ? OptionallyHasInitPreContext<ReturnType<TLeft['initPreContext']>, any>
    : {}) &
    (TLeft extends HasExtractInputs<any, any>
      ? OptionallyHasExtractInputs<ReturnType<TLeft['extractInputs']>, any>
      : {}) &
    (TLeft extends HasSanitizeInputs<any, any>
      ? OptionallyHasSanitizeInputs<ReturnType<TLeft['sanitizeInputs']>, any>
      : {}) &
    (TLeft extends HasPreAuthorize<any, any>
      ? MightHavePreAuthorize<ReturnType<TLeft['preAuthorize']>, any>
      : {}) &
    (TLeft extends HasAttachData<any, any>
      ? OptionallyHasAttachData<
          PromiseResolveOrSync<ReturnType<TLeft['attachData']>>,
          any
        >
      : {}) &
    (TLeft extends HasFinalAuthorize<any, any>
      ? MightHaveFinalAuthorize<
          PromiseResolveOrSync<ReturnType<TLeft['finalAuthorize']>>,
          any
        >
      : {}) &
    (TLeft extends HasDoWork<any, any>
      ? OptionallyHasDoWork<
          PromiseResolveOrSync<ReturnType<TLeft['doWork']>>,
          any
        >
      : {}) &
    (TLeft extends HasSanitizeResponse<any, any>
      ? MightHaveSanitizeResponse<ReturnType<TLeft['sanitizeResponse']>, any>
      : {})
>(
  left: TLeft,
  right: TRight
): PipedPreContext<TLeft, TRight> &
  PipedExtractInputs<TLeft, TRight> &
  PipedSanitizeInputs<TLeft, TRight> &
  PipedPreAuthorize<TLeft, TRight> &
  PipedAttachData<TLeft, TRight> &
  PipedFinalAuthorize<TLeft, TRight> &
  PipedDoWork<TLeft, TRight> &
  PipedSanitizeResponse<TLeft, TRight>;

// two parameters with possibly added inputs
export function HTPipe<
  TLeft extends ClashlessInitPreContext<TLeft, TRight> &
    ClashlessExtractInputs<TLeft, TRight> &
    ClashlessSanitizeInputs<TLeft, TRight> &
    ClashlessPreAuthorize<TLeft, TRight> &
    ClashlessAttachData<TLeft, TRight> &
    ClashlessFinalAuthorize<TLeft, TRight> &
    ClashlessDoWork<TLeft, TRight> &
    ClashlessSanitizeResponse<TLeft, TRight>,
  TRight extends OptionallyHasInitPreContext<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    MightHavePreAuthorize<any, any> &
    OptionallyHasAttachData<any, any> &
    MightHaveFinalAuthorize<any, any> &
    OptionallyHasDoWork<any, any> &
    MightHaveSanitizeResponse<any, any>
>(
  left: TLeft,
  right: TRight
): PipedPreContext<TLeft, TRight> &
  PipedExtractInputs<TLeft, TRight> &
  PipedSanitizeInputs<TLeft, TRight> &
  PipedPreAuthorize<TLeft, TRight> &
  PipedAttachData<TLeft, TRight> &
  PipedFinalAuthorize<TLeft, TRight> &
  PipedDoWork<TLeft, TRight> &
  PipedSanitizeResponse<TLeft, TRight>;

// three parameters with possibly added inputs
export function HTPipe<
  T3 extends ClashlessInitPreContext<T3, PipedPreContext<T2, T1>> &
    ClashlessExtractInputs<T3, PipedExtractInputs<T2, T1>> &
    ClashlessSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>> &
    ClashlessPreAuthorize<T3, PipedPreAuthorize<T2, T1>> &
    ClashlessAttachData<T3, PipedAttachData<T2, T1>> &
    ClashlessFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>> &
    ClashlessDoWork<T3, PipedDoWork<T2, T1>> &
    ClashlessSanitizeResponse<T3, PipedSanitizeResponse<T2, T1>>,
  T2 extends ClashlessInitPreContext<T2, T1> &
    ClashlessExtractInputs<T2, T1> &
    ClashlessSanitizeInputs<T2, T1> &
    ClashlessPreAuthorize<T2, T1> &
    ClashlessAttachData<T2, T1> &
    ClashlessFinalAuthorize<T2, T1> &
    ClashlessDoWork<T2, T1> &
    ClashlessSanitizeResponse<T2, T1>,
  T1 extends OptionallyHasInitPreContext<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    MightHavePreAuthorize<any, any> &
    OptionallyHasAttachData<any, any> &
    MightHaveFinalAuthorize<any, any> &
    OptionallyHasDoWork<any, any> &
    MightHaveSanitizeResponse<any, any>
>(
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedPreContext<T3, PipedPreContext<T2, T1>> &
  PipedExtractInputs<T3, PipedExtractInputs<T2, T1>> &
  PipedSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>> &
  PipedPreAuthorize<T3, PipedPreAuthorize<T2, T1>> &
  PipedAttachData<T3, PipedAttachData<T2, T1>> &
  PipedFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>> &
  PipedDoWork<T3, PipedDoWork<T2, T1>> &
  PipedSanitizeResponse<T3, PipedSanitizeResponse<T2, T1>>;

// four parameters with possibly added inputs
export function HTPipe<
  T4 extends ClashlessInitPreContext<
    T4,
    PipedPreContext<T3, PipedPreContext<T2, T1>>
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
    ClashlessAttachData<T4, PipedAttachData<T3, PipedAttachData<T2, T1>>> &
    ClashlessFinalAuthorize<
      T4,
      PipedFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>>
    > &
    ClashlessDoWork<T4, PipedDoWork<T3, PipedDoWork<T2, T1>>> &
    ClashlessSanitizeResponse<
      T4,
      PipedSanitizeResponse<T3, PipedSanitizeResponse<T2, T1>>
    >,
  T3 extends ClashlessInitPreContext<T3, PipedPreContext<T2, T1>> &
    ClashlessExtractInputs<T3, PipedExtractInputs<T2, T1>> &
    ClashlessSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>> &
    ClashlessPreAuthorize<T3, PipedPreAuthorize<T2, T1>> &
    ClashlessAttachData<T3, PipedAttachData<T2, T1>> &
    ClashlessFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>> &
    ClashlessDoWork<T3, PipedDoWork<T2, T1>> &
    ClashlessSanitizeResponse<T3, PipedSanitizeResponse<T2, T1>>,
  T2 extends ClashlessInitPreContext<T2, T1> &
    ClashlessExtractInputs<T2, T1> &
    ClashlessSanitizeInputs<T2, T1> &
    ClashlessPreAuthorize<T2, T1> &
    ClashlessAttachData<T2, T1> &
    ClashlessFinalAuthorize<T2, T1> &
    ClashlessDoWork<T2, T1> &
    ClashlessSanitizeResponse<T2, T1>,
  T1 extends OptionallyHasInitPreContext<any, any> &
    OptionallyHasExtractInputs<any, any> &
    OptionallyHasSanitizeInputs<any, any> &
    MightHavePreAuthorize<any, any> &
    OptionallyHasAttachData<any, any> &
    MightHaveFinalAuthorize<any, any> &
    OptionallyHasDoWork<any, any> &
    MightHaveSanitizeResponse<any, any>
>(
  obj4: T4,
  obj3: T3,
  obj2: T2,
  obj1: T1
): PipedPreContext<T4, PipedPreContext<T3, PipedPreContext<T2, T1>>> &
  PipedExtractInputs<T4, PipedExtractInputs<T3, PipedExtractInputs<T2, T1>>> &
  PipedSanitizeInputs<
    T4,
    PipedSanitizeInputs<T3, PipedSanitizeInputs<T2, T1>>
  > &
  PipedPreAuthorize<T4, PipedPreAuthorize<T3, PipedPreAuthorize<T2, T1>>> &
  PipedAttachData<T4, PipedAttachData<T3, PipedAttachData<T2, T1>>> &
  PipedFinalAuthorize<
    T4,
    PipedFinalAuthorize<T3, PipedFinalAuthorize<T2, T1>>
  > &
  PipedDoWork<T4, PipedDoWork<T3, PipedDoWork<T2, T1>>> &
  PipedSanitizeResponse<
    T4,
    PipedSanitizeResponse<T3, PipedSanitizeResponse<T2, T1>>
  >;

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
      ...((isHasInitPreContext(left) && isHasInitPreContext(right)
        ? {
            initPreContext: (context: any) => {
              const leftOut = left.initPreContext(context) || {};
              const rightIn = {
                ...context,
                ...(leftOut as {}),
              };
              const rightOut = right.initPreContext(rightIn) || {};
              return {
                ...(leftOut as {}),
                ...(rightOut as {}),
              };
            },
          }
        : isHasInitPreContext(left)
        ? { initPreContext: left.initPreContext }
        : isHasInitPreContext(right)
        ? { initPreContext: right.initPreContext }
        : {}) as PipedPreContext<any, any>),
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
      ...((isHasAttachData(left) && isHasAttachData(right)
        ? {
            attachData: async (context: any) => {
              const leftOut =
                (await Promise.resolve(left.attachData(context))) || {};
              const rightIn = {
                ...context,
                ...(leftOut as {}),
              };
              const rightOut =
                (await Promise.resolve(right.attachData(rightIn))) || {};
              return {
                ...(leftOut as {}),
                ...(rightOut as {}),
              };
            },
          }
        : isHasAttachData(left)
        ? { attachData: left.attachData }
        : isHasAttachData(right)
        ? { attachData: right.attachData }
        : {}) as PipedAttachData<any, any>),
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
      ...((isHasDoWork(left) && isHasDoWork(right)
        ? {
            doWork: async (context: any) => {
              await Promise.resolve(left.doWork(context));
              return await Promise.resolve(right.doWork(context));
            },
          }
        : isHasDoWork(left)
        ? { doWork: left.doWork }
        : isHasDoWork(right)
        ? { doWork: right.doWork }
        : {}) as PipedDoWork<any, any>),
      ...((isHasSanitizeResponse(left) && isHasSanitizeResponse(right)
        ? {
            sanitizeResponse: (context: any) => {
              const leftOut = left.sanitizeResponse(context) || {};
              const rightOut = right.sanitizeResponse(leftOut) || {};
              return rightOut;
            },
          }
        : isHasSanitizeResponse(left)
        ? { sanitizeResponse: left.sanitizeResponse }
        : isHasSanitizeResponse(right)
        ? { sanitizeResponse: right.sanitizeResponse }
        : {}) as PipedSanitizeResponse<any, any>),
    };
  }

  return objs.reduce((prev: any, curr: any) => HTPipe(prev, curr), {});
}

/**
 * A pipeable object is any object that has one or more lifecycle stage functions.
 * This type represents the union of all possible stage configurations.
 */
type Pipeable = OptionallyHasInitPreContext<any, any> &
  OptionallyHasExtractInputs<any, any> &
  OptionallyHasSanitizeInputs<any, any> &
  MightHavePreAuthorize<any, any> &
  OptionallyHasAttachData<any, any> &
  MightHaveFinalAuthorize<any, any> &
  OptionallyHasDoWork<any, any> &
  MightHaveSanitizeResponse<any, any>;

export function composePipes(
  ...pipes: Pipeable[]
): HasAllNotRequireds & HasAllRequireds {
  return pipes.reduce(
    (prev, curr) => HTPipe(prev, curr),
    {} as Pipeable
  ) as HasAllNotRequireds & HasAllRequireds;
}

// left has attachData AND right has attachData AND left's return keys that exist in right's parameters are assignable to right's correspondingly
export function HTPipeAttachData<
  TLeft extends HasAttachData<
    any,
    TRight extends HasAttachData<any, any>
      ? Pick<
          Parameters<TRight['attachData']>[0],
          keyof PromiseResolveOrSync<
            ReturnType<
              TLeft extends HasAttachData<any, any>
                ? TLeft['attachData']
                : () => {}
            >
          >
        >
      : any
  >,
  TRight extends HasAttachData<any, any>,
  TContextInLeft extends Parameters<TLeft['attachData']>[0],
  TContextInRight extends Parameters<TRight['attachData']>[0],
  TContextOutLeft extends PromiseResolveOrSync<ReturnType<TLeft['attachData']>>,
  TContextOutRight extends PromiseResolveOrSync<
    ReturnType<TRight['attachData']>
  >
>(
  left: TLeft,
  right: TRight
): HasAttachData<
  TContextInLeft & Omit<TContextInRight, keyof TContextOutLeft>,
  TContextOutRight & Omit<TContextOutLeft, keyof TContextOutRight>
>;

export function HTPipeAttachData<
  TLeft extends HasAttachData<
    any,
    TRight extends HasAttachData<any, any>
      ? Pick<
          Parameters<TRight['attachData']>[0],
          keyof PromiseResolveOrSync<
            ReturnType<
              TLeft extends HasAttachData<any, any>
                ? TLeft['attachData']
                : () => {}
            >
          >
        >
      : any
  >,
  TRight extends OptionallyHasAttachData<any, any>,
  TContextInLeft extends Parameters<TLeft['attachData']>[0],
  TContextOutLeft extends PromiseResolveOrSync<ReturnType<TLeft['attachData']>>
>(left: TLeft, right: TRight): HasAttachData<TContextInLeft, TContextOutLeft>;

export function HTPipeAttachData<
  TLeft extends OptionallyHasAttachData<
    any,
    TRight extends HasAttachData<any, any>
      ? Pick<
          Parameters<TRight['attachData']>[0],
          keyof PromiseResolveOrSync<
            ReturnType<
              TLeft extends HasAttachData<any, any>
                ? TLeft['attachData']
                : () => {}
            >
          >
        >
      : any
  >,
  TRight extends HasAttachData<any, any>,
  TContextInRight extends Parameters<TRight['attachData']>[0],
  TContextOutRight extends PromiseResolveOrSync<
    ReturnType<TRight['attachData']>
  >
>(left: TLeft, right: TRight): HasAttachData<TContextInRight, TContextOutRight>;

export function HTPipeAttachData<
  TLeft extends OptionallyHasAttachData<
    any,
    TRight extends HasAttachData<any, any>
      ? Pick<
          Parameters<TRight['attachData']>[0],
          keyof PromiseResolveOrSync<
            ReturnType<
              TLeft extends HasAttachData<any, any>
                ? TLeft['attachData']
                : () => {}
            >
          >
        >
      : any
  >,
  TRight extends OptionallyHasAttachData<any, any>
>(left: TLeft, right: TRight): {};

export function HTPipeAttachData<
  TLeft extends OptionallyHasAttachData<any, any>,
  TRight extends OptionallyHasAttachData<any, any>,
  TContextInLeft extends TLeft extends HasAttachData<any, any>
    ? Parameters<TLeft['attachData']>[0]
    : never,
  TContextInRight extends TRight extends HasAttachData<any, any>
    ? Parameters<TRight['attachData']>[0]
    : never,
  TContextOutLeft extends TLeft extends HasAttachData<any, any>
    ? PromiseResolveOrSync<ReturnType<TLeft['attachData']>>
    : never,
  TContextOutRight extends TRight extends HasAttachData<any, any>
    ? PromiseResolveOrSync<ReturnType<TRight['attachData']>>
    : never
>(left: TLeft, right: TRight) {
  if (isHasAttachData(left) && isHasAttachData(right)) {
    return {
      attachData: async (
        context: TContextOutLeft extends TContextInRight
          ? TContextInLeft
          : TContextInRight & TContextInLeft
      ) => {
        const leftOut = (await Promise.resolve(left.attachData(context))) || {};
        const rightIn = {
          ...context,
          ...leftOut,
        };
        const rightOut =
          (await Promise.resolve(right.attachData(rightIn))) || {};
        return { ...leftOut, ...rightOut };
      },
    };
  } else if (isHasAttachData(left)) {
    return { attachData: left.attachData };
  } else if (isHasAttachData(right)) {
    return { attachData: right.attachData };
  } else {
    return {};
  }
}

export function HTPipePreAuthorize<
  TLeft extends HasPreAuthorize<
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
  >,
  TRight extends HasPreAuthorize<any, any>,
  TContextInLeft extends Parameters<TLeft['preAuthorize']>[0],
  TContextInRight extends Parameters<TRight['preAuthorize']>[0],
  TContextOutLeft extends ReturnType<TLeft['preAuthorize']>,
  TContextOutRight extends ReturnType<TRight['preAuthorize']>
>(
  left: TLeft,
  right: TRight
): HasPreAuthorize<
  TContextInLeft &
    Omit<
      TContextInRight,
      TContextOutLeft extends boolean ? keyof {} : keyof TContextOutLeft
    >,
  TContextOutRight &
    Omit<
      TContextOutLeft,
      TContextOutRight extends boolean ? keyof {} : keyof TContextOutRight
    >
>;

export function HTPipePreAuthorize<
  TLeft extends HasPreAuthorize<
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
  >,
  TRight extends MightHavePreAuthorize<any, any>,
  TContextInLeft extends Parameters<TLeft['preAuthorize']>[0],
  TContextOutLeft extends ReturnType<TLeft['preAuthorize']>
>(left: TLeft, right: TRight): HasPreAuthorize<TContextInLeft, TContextOutLeft>;

export function HTPipePreAuthorize<
  TLeft extends MightHavePreAuthorize<
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
  >,
  TRight extends HasPreAuthorize<any, any>,
  TContextInRight extends Parameters<TRight['preAuthorize']>[0],
  TContextOutRight extends ReturnType<TRight['preAuthorize']>
>(
  left: TLeft,
  right: TRight
): HasPreAuthorize<TContextInRight, TContextOutRight>;

export function HTPipePreAuthorize<
  TLeft extends MightHavePreAuthorize<
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
  >,
  TRight extends MightHavePreAuthorize<any, any>
>(left: TLeft, right: TRight): {};

export function HTPipePreAuthorize<
  TLeft extends MightHavePreAuthorize<any, any>,
  TRight extends MightHavePreAuthorize<any, any>,
  TContextInLeft extends TLeft extends HasPreAuthorize<any, any>
    ? Parameters<TLeft['preAuthorize']>[0]
    : never,
  TContextInRight extends TRight extends HasPreAuthorize<any, any>
    ? Parameters<TRight['preAuthorize']>[0]
    : never,
  TContextOutLeft extends TLeft extends HasPreAuthorize<any, any>
    ? ReturnType<TLeft['preAuthorize']>
    : never,
  TContextOutRight extends TRight extends HasPreAuthorize<any, any>
    ? ReturnType<TRight['preAuthorize']>
    : never
>(left: TLeft, right: TRight) {
  if (isHasPreAuthorize(left) && isHasPreAuthorize(right)) {
    return {
      preAuthorize: (
        context: TContextOutLeft extends TContextInRight
          ? TContextInLeft
          : TContextInRight & TContextInLeft
      ) => {
        const leftOut = left.preAuthorize(context);
        const leftPassed = authorizationPassed(leftOut);
        if (!leftPassed) {
          return false;
        }
        const leftContextOut = leftPassed === true ? {} : leftOut;
        const rightIn = {
          ...context,
          ...leftContextOut,
        };
        const rightOut = right.preAuthorize(rightIn);
        const rightPassed = authorizationPassed(rightOut);
        if (!rightPassed) {
          return false;
        }
        if (leftOut === true && rightOut === true) {
          return true;
        }
        const rightContextOut = rightOut === true ? {} : rightOut;
        return {
          ...leftContextOut,
          ...rightContextOut,
        };
      },
    };
  } else if (isHasPreAuthorize(left)) {
    return {
      preAuthorize: left.preAuthorize,
    };
  } else if (isHasPreAuthorize(right)) {
    return {
      preAuthorize: right.preAuthorize,
    };
  } else {
    return {};
  }
}

export function HTPipeFinalAuthorize<
  TLeft extends HasFinalAuthorize<
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
  >,
  TRight extends HasFinalAuthorize<any, any>,
  TContextInLeft extends Parameters<TLeft['finalAuthorize']>[0],
  TContextInRight extends Parameters<TRight['finalAuthorize']>[0],
  TContextOutLeft extends PromiseResolveOrSync<
    ReturnType<TLeft['finalAuthorize']>
  >,
  TContextOutRight extends PromiseResolveOrSync<
    ReturnType<TRight['finalAuthorize']>
  >
>(
  left: TLeft,
  right: TRight
): HasFinalAuthorize<
  TContextInLeft &
    Omit<
      TContextInRight,
      TContextOutLeft extends boolean ? keyof {} : keyof TContextOutLeft
    >,
  TContextOutRight &
    Omit<
      TContextOutLeft,
      TContextOutRight extends boolean ? keyof {} : keyof TContextOutRight
    >
>;

export function HTPipeFinalAuthorize<
  TLeft extends HasFinalAuthorize<
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
  >,
  TRight extends MightHaveFinalAuthorize<any, any>,
  TContextInLeft extends Parameters<TLeft['finalAuthorize']>[0],
  TContextOutLeft extends PromiseResolveOrSync<
    ReturnType<TLeft['finalAuthorize']>
  >
>(
  left: TLeft,
  right: TRight
): HasFinalAuthorize<TContextInLeft, TContextOutLeft>;

export function HTPipeFinalAuthorize<
  TLeft extends MightHaveFinalAuthorize<
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
  >,
  TRight extends HasFinalAuthorize<any, any>,
  TContextInRight extends Parameters<TRight['finalAuthorize']>[0],
  TContextOutRight extends PromiseResolveOrSync<
    ReturnType<TRight['finalAuthorize']>
  >
>(
  left: TLeft,
  right: TRight
): HasFinalAuthorize<TContextInRight, TContextOutRight>;

export function HTPipeFinalAuthorize<
  TLeft extends MightHaveFinalAuthorize<
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
  >,
  TRight extends MightHaveFinalAuthorize<any, any>
>(left: TLeft, right: TRight): {};

export function HTPipeFinalAuthorize<
  TLeft extends MightHaveFinalAuthorize<any, any>,
  TRight extends MightHaveFinalAuthorize<any, any>,
  TContextInLeft extends TLeft extends HasFinalAuthorize<any, any>
    ? Parameters<TLeft['finalAuthorize']>[0]
    : never,
  TContextInRight extends TRight extends HasFinalAuthorize<any, any>
    ? Parameters<TRight['finalAuthorize']>[0]
    : never,
  TContextOutLeft extends TLeft extends HasFinalAuthorize<any, any>
    ? PromiseResolveOrSync<ReturnType<TLeft['finalAuthorize']>>
    : never,
  TContextOutRight extends TRight extends HasFinalAuthorize<any, any>
    ? PromiseResolveOrSync<ReturnType<TRight['finalAuthorize']>>
    : never
>(left: TLeft, right: TRight) {
  if (isHasFinalAuthorize(left) && isHasFinalAuthorize(right)) {
    return {
      finalAuthorize: async (
        context: TContextOutLeft extends TContextInRight
          ? TContextInLeft
          : TContextInRight & TContextInLeft
      ) => {
        const leftOut = await Promise.resolve(left.finalAuthorize(context));
        const leftPassed = authorizationPassed(leftOut);
        if (!leftPassed) {
          return false;
        }
        const leftContextOut = leftOut === true ? {} : leftOut;
        const rightIn = {
          ...context,
          ...leftContextOut,
        };
        const rightOut = await Promise.resolve(right.finalAuthorize(rightIn));
        const rightPassed = authorizationPassed(rightOut);
        if (!rightPassed) {
          return false;
        }
        if (leftOut === true && rightOut === true) {
          return true;
        }
        const rightContextOut = rightOut === true ? {} : rightOut;
        return {
          ...leftContextOut,
          ...rightContextOut,
        };
      },
    };
  } else if (isHasFinalAuthorize(left)) {
    return { finalAuthorize: left.finalAuthorize };
  } else if (isHasFinalAuthorize(right)) {
    return { finalAuthorize: right.finalAuthorize };
  } else {
    return {};
  }
}

export function HTPipeInitPreContext<
  TLeft extends HasInitPreContext<
    any,
    TRight extends HasInitPreContext<any, any>
      ? Pick<
          Parameters<TRight['initPreContext']>[0],
          keyof ReturnType<
            TLeft extends HasInitPreContext<any, any>
              ? TLeft['initPreContext']
              : () => {}
          >
        >
      : any
  >,
  TRight extends HasInitPreContext<any, any>,
  TContextInLeft extends Parameters<TLeft['initPreContext']>[0],
  TContextInRight extends Parameters<TRight['initPreContext']>[0],
  TContextOutLeft extends ReturnType<TLeft['initPreContext']>,
  TContextOutRight extends ReturnType<TRight['initPreContext']>
>(
  left: TLeft,
  right: TRight
): HasInitPreContext<
  TContextInLeft & Omit<TContextInRight, keyof TContextOutLeft>,
  TContextOutRight & Omit<TContextOutLeft, keyof TContextOutRight>
>;

export function HTPipeInitPreContext<
  TLeft extends HasInitPreContext<
    any,
    TRight extends HasInitPreContext<any, any>
      ? Pick<
          Parameters<TRight['initPreContext']>[0],
          keyof ReturnType<
            TLeft extends HasInitPreContext<any, any>
              ? TLeft['initPreContext']
              : () => {}
          >
        >
      : any
  >,
  TRight extends OptionallyHasInitPreContext<any, any>,
  TContextInLeft extends Parameters<TLeft['initPreContext']>[0],
  TContextOutLeft extends ReturnType<TLeft['initPreContext']>
>(
  left: TLeft,
  right: TRight
): HasInitPreContext<TContextInLeft, TContextOutLeft>;

export function HTPipeInitPreContext<
  TLeft extends OptionallyHasInitPreContext<
    any,
    TRight extends HasInitPreContext<any, any>
      ? Pick<
          Parameters<TRight['initPreContext']>[0],
          keyof ReturnType<
            TLeft extends HasInitPreContext<any, any>
              ? TLeft['initPreContext']
              : () => {}
          >
        >
      : any
  >,
  TRight extends HasInitPreContext<any, any>,
  TContextInRight extends Parameters<TRight['initPreContext']>[0],
  TContextOutRight extends ReturnType<TRight['initPreContext']>
>(
  left: TLeft,
  right: TRight
): HasInitPreContext<TContextInRight, TContextOutRight>;

export function HTPipeInitPreContext<
  TLeft extends OptionallyHasInitPreContext<
    any,
    TRight extends HasInitPreContext<any, any>
      ? Pick<
          Parameters<TRight['initPreContext']>[0],
          keyof ReturnType<
            TLeft extends HasInitPreContext<any, any>
              ? TLeft['initPreContext']
              : () => {}
          >
        >
      : any
  >,
  TRight extends OptionallyHasInitPreContext<any, any>
>(left: TLeft, right: TRight): {};

export function HTPipeInitPreContext<
  TLeft extends OptionallyHasInitPreContext<any, any>,
  TRight extends OptionallyHasInitPreContext<any, any>,
  TContextInLeft extends TLeft extends HasInitPreContext<any, any>
    ? Parameters<TLeft['initPreContext']>[0]
    : never,
  TContextInRight extends TRight extends HasInitPreContext<any, any>
    ? Parameters<TRight['initPreContext']>[0]
    : never,
  TContextOutLeft extends TLeft extends HasInitPreContext<any, any>
    ? ReturnType<TLeft['initPreContext']>
    : never,
  TContextOutRight extends TRight extends HasInitPreContext<any, any>
    ? ReturnType<TRight['initPreContext']>
    : never
>(left: TLeft, right: TRight) {
  if (isHasInitPreContext(left) && isHasInitPreContext(right)) {
    return {
      initPreContext: (
        context: TContextOutLeft extends TContextInRight
          ? TContextInLeft
          : TContextInRight & TContextInLeft
      ) => {
        const leftOut = left.initPreContext(context) || {};
        const rightIn = {
          ...context,
          ...leftOut,
        };
        const rightOut = right.initPreContext(rightIn) || {};
        return {
          ...leftOut,
          ...rightOut,
        };
      },
    };
  } else if (isHasInitPreContext(left)) {
    return { initPreContext: left.initPreContext };
  } else if (isHasInitPreContext(right)) {
    return { initPreContext: right.initPreContext };
  } else {
    return {};
  }
}

export function HTPipeExtractInputs<
  TLeft extends OptionallyHasExtractInputs<any, any>,
  TRight extends OptionallyHasExtractInputs<any, any>
>(left: TLeft, right: TRight) {
  if (isHasExtractInputs(left) && isHasExtractInputs(right)) {
    return {
      extractInputs: (context: any) => {
        const leftOut = left.extractInputs(context) || {};
        const rightIn = {
          ...context,
          ...leftOut,
        };
        const rightOut = right.extractInputs(rightIn) || {};
        return {
          ...leftOut,
          ...rightOut,
        };
      },
    };
  } else if (isHasExtractInputs(left)) {
    return { extractInputs: left.extractInputs };
  } else if (isHasExtractInputs(right)) {
    return { extractInputs: right.extractInputs };
  } else {
    return {};
  }
}

export function HTPipeDoWork<
  TLeft extends OptionallyHasDoWork<any, any>,
  TRight extends OptionallyHasDoWork<any, any>
>(left: TLeft, right: TRight) {
  if (isHasDoWork(left) && isHasDoWork(right)) {
    return {
      doWork: async (context: any) => {
        await Promise.resolve(left.doWork(context));
        return await Promise.resolve(right.doWork(context));
      },
    };
  } else if (isHasDoWork(left)) {
    return { doWork: left.doWork };
  } else if (isHasDoWork(right)) {
    return { doWork: right.doWork };
  } else {
    return {};
  }
}

export function HTPipeSanitizeInputs<
  TLeft extends OptionallyHasSanitizeInputs<any, any>,
  TRight extends OptionallyHasSanitizeInputs<any, any>
>(left: TLeft, right: TRight) {
  if (isHasSanitizeInputs(left) && isHasSanitizeInputs(right)) {
    return {
      sanitizeInputs: (context: any) => {
        const leftOut = left.sanitizeInputs(context) || {};
        const rightOut = right.sanitizeInputs(leftOut) || {};
        return rightOut;
      },
    };
  } else if (isHasSanitizeInputs(left)) {
    return { sanitizeInputs: left.sanitizeInputs };
  } else if (isHasSanitizeInputs(right)) {
    return { sanitizeInputs: right.sanitizeInputs };
  } else {
    return {};
  }
}

export function HTPipeSanitizeResponse<
  TLeft extends MightHaveSanitizeResponse<any, any>,
  TRight extends MightHaveSanitizeResponse<any, any>
>(left: TLeft, right: TRight) {
  if (isHasSanitizeResponse(left) && isHasSanitizeResponse(right)) {
    return {
      sanitizeResponse: (context: any) => {
        const leftOut = left.sanitizeResponse(context) || {};
        const rightOut = right.sanitizeResponse(leftOut) || {};
        return rightOut;
      },
    };
  } else if (isHasSanitizeResponse(left)) {
    return { sanitizeResponse: left.sanitizeResponse };
  } else if (isHasSanitizeResponse(right)) {
    return { sanitizeResponse: right.sanitizeResponse };
  } else {
    return {};
  }
}

export * from './core';
export * from './express';
export * from './trpc';
export * from './mongoose';
export * from './zod';
export * from './user';
export * from './lifecycle-functions';
