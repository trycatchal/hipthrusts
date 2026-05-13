export type Constructor<T = {}> = new (...args: any[]) => T;

export type PromiseOrSync<T> = Promise<T> | T;
export type PromiseResolveOrSync<T> = T extends Promise<infer U> ? U : T;

export type AllAsyncStageKeys = 'attachData' | 'finalAuthorize' | 'doWork';
export type AllSyncStageKeys =
  | 'initPreContext'
  | 'extractInputs'
  | 'sanitizeInputs'
  | 'preAuthorize'
  | 'sanitizeResponse';
export type AllStageKeys = AllAsyncStageKeys | AllSyncStageKeys;

export interface OptionallyHasInitPreContext<TUnsafe, TContextInit> {
  initPreContext?: (unsafe: TUnsafe) => TContextInit;
}

export interface HasInitPreContext<TUnsafe, TContextInit> {
  initPreContext: (unsafe: TUnsafe) => TContextInit;
}

export interface OptionallyHasExtractInputs<TContextIn, TUnsafeInputs> {
  extractInputs?: (context: TContextIn) => TUnsafeInputs;
}

export interface HasExtractInputs<TContextIn, TUnsafeInputs> {
  extractInputs: (context: TContextIn) => TUnsafeInputs;
}

export interface OptionallyHasSanitizeInputs<TUnsafeInputs, TSafeInputs> {
  sanitizeInputs?: (unsafeInputs: TUnsafeInputs) => TSafeInputs;
}

export interface HasSanitizeInputs<TUnsafeInputs, TSafeInputs> {
  sanitizeInputs: (unsafeInputs: TUnsafeInputs) => TSafeInputs;
}

export interface HasPreAuthorize<TContextIn, TContextOut> {
  preAuthorize: (context: TContextIn) => TContextOut;
}

export interface MightHavePreAuthorize<TContextIn, TContextOut> {
  preAuthorize?: (context: TContextIn) => TContextOut;
}

export interface OptionallyHasAttachData<TContextIn, TContextOut> {
  attachData?: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface HasAttachData<TContextIn, TContextOut> {
  attachData: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface MightHaveFinalAuthorize<TContextIn, TContextOut> {
  finalAuthorize?: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface HasFinalAuthorize<TContextIn, TContextOut> {
  finalAuthorize: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface OptionallyHasDoWork<TContextIn, TUnsafeResponse> {
  doWork?: (context: TContextIn) => PromiseOrSync<TUnsafeResponse>;
}

export interface HasDoWork<TContextIn, TUnsafeResponse> {
  doWork: (context: TContextIn) => PromiseOrSync<TUnsafeResponse>;
}

export interface MightHaveSanitizeResponse<TUnsafeResponse, TResponse> {
  sanitizeResponse?: (unsafe: TUnsafeResponse) => TResponse;
}

export interface HasSanitizeResponse<TUnsafeResponse, TResponse> {
  sanitizeResponse: (unsafe: TUnsafeResponse) => TResponse;
}

export type HasAllRequireds = HasSanitizeInputs<any, any> &
  HasPreAuthorize<any, any> &
  HasFinalAuthorize<any, any> &
  HasDoWork<any, any> &
  HasSanitizeResponse<any, any>;

export type HasAllNotRequireds = OptionallyHasInitPreContext<any, any> &
  OptionallyHasExtractInputs<any, any> &
  OptionallyHasAttachData<any, any>;

export type HasAllStagesNotOptionals = HasInitPreContext<any, any> &
  HasExtractInputs<any, any> &
  HasSanitizeInputs<any, any> &
  HasPreAuthorize<any, any> &
  HasAttachData<any, any> &
  HasFinalAuthorize<any, any> &
  HasDoWork<any, any> &
  HasSanitizeResponse<any, any>;

export type HasAllStagesOptionals = OptionallyHasInitPreContext<any, any> &
  OptionallyHasExtractInputs<any, any> &
  OptionallyHasSanitizeInputs<any, any> &
  MightHavePreAuthorize<any, any> &
  OptionallyHasAttachData<any, any> &
  MightHaveFinalAuthorize<any, any> &
  OptionallyHasDoWork<any, any> &
  MightHaveSanitizeResponse<any, any>;

/*
type Funcs = {
  a: () => void;
  v: (text: string) => number;
};
type IPFuncs = IntersectProperties<Funcs>;
// type IPFuncs = (() => void) & ((text: string) => number) 👍
type Foo = { a: string; b: number };
type Bar = IntersectProperties<Foo>;
// type Bar = string & number 😕
*/

type IntersectProperties<T extends object> = keyof T extends never
  ? {}
  : { [K in keyof T]: (arg: T[K]) => void } extends Record<
      keyof T,
      (arg: infer A) => void
    >
  ? A
  : never;

type ReturnedTypeUpToPreAuthorize<TValue, TKey> = TKey extends 'inputs'
  ? HasSanitizeInputs<any, TValue>
  : TKey extends 'preContext'
  ? HasInitPreContext<any, TValue>
  : {};

export type PreAuthReqsSatisfied<
  T extends HasPreAuthorize<any, any>
> = IntersectProperties<
  {
    [P in keyof Parameters<T['preAuthorize']>[0]]: ReturnedTypeUpToPreAuthorize<
      Parameters<T['preAuthorize']>[0][P],
      P
    >;
  }
>;

type OptionalAttachDataParams<T> = [T] extends [HasAttachData<any, any>]
  ? Parameters<T['attachData']>[0]
  : {};

type ReturnedSomewhereUpToAttachData<
  TOut,
  TValue,
  TKey extends string | symbol | number
> = [TOut] extends [HasPreAuthorize<any, Record<TKey, TValue>>]
  ? HasPreAuthorize<any, Record<TKey, TValue>>
  : never;

type AllInitKeys = 'preContext' | 'inputs';

export type AttachDataReqsSatisfiedOptional<T> = IntersectProperties<
  {
    [P in keyof OptionalAttachDataParams<T>]: [P] extends [AllInitKeys]
      ? ReturnedTypeUpToPreAuthorize<OptionalAttachDataParams<T>[P], P>
      : ReturnedSomewhereUpToAttachData<T, OptionalAttachDataParams<T>[P], P>;
  }
>;

type ReturnedSomewhereUpToFinalAuthorize<
  TOut,
  TValue,
  TKey extends string | symbol | number
> = [TOut] extends [HasAttachData<any, Record<TKey, TValue>>]
  ? HasAttachData<any, Record<TKey, TValue>>
  : [TOut] extends [HasPreAuthorize<any, Record<TKey, TValue>>]
  ? HasPreAuthorize<any, Record<TKey, TValue>>
  : never;

export type FinalAuthReqsSatisfied<
  T extends HasFinalAuthorize<any, any>
> = IntersectProperties<
  {
    [P in keyof Parameters<T['finalAuthorize']>[0]]: [P] extends [AllInitKeys]
      ? ReturnedTypeUpToPreAuthorize<Parameters<T['finalAuthorize']>[0][P], P>
      : ReturnedSomewhereUpToFinalAuthorize<
          T,
          Parameters<T['finalAuthorize']>[0][P],
          P
        >;
  }
>;

type OptionalDoWorkParams<T> = [T] extends [HasDoWork<any, any>]
  ? Parameters<T['doWork']>[0]
  : {};

type ReturnedSomewhereUpToDoWork<
  TOut,
  TValue,
  TKey extends string | symbol | number
> = [TOut] extends [HasFinalAuthorize<any, Record<TKey, TValue>>]
  ? HasFinalAuthorize<any, Record<TKey, TValue>>
  : [TOut] extends [HasAttachData<any, Record<TKey, TValue>>]
  ? HasAttachData<any, Record<TKey, TValue>>
  : [TOut] extends [HasPreAuthorize<any, Record<TKey, TValue>>]
  ? HasPreAuthorize<any, Record<TKey, TValue>>
  : never;

export type DoWorkReqsSatisfiedOptional<T> = IntersectProperties<
  {
    [P in keyof OptionalDoWorkParams<T>]: [P] extends [AllInitKeys]
      ? ReturnedTypeUpToPreAuthorize<OptionalDoWorkParams<T>[P], P>
      : ReturnedSomewhereUpToDoWork<T, OptionalDoWorkParams<T>[P], P>;
  }
>;

type ReturnedSomewhereUpToSanitizeResponse<TOut, TValue> = [TOut] extends [
  HasDoWork<any, TValue>
]
  ? HasDoWork<any, TValue>
  : never;

export type SanitizeResponseReqsSatisfied<
  T extends HasSanitizeResponse<any, any>
> = IntersectProperties<
  {
    [P in keyof Parameters<
      T['sanitizeResponse']
    >[0]]: ReturnedSomewhereUpToSanitizeResponse<
      T,
      Record<P, Parameters<T['sanitizeResponse']>[0][P]>
    >;
  }
>;
