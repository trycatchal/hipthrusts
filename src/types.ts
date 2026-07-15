export type Constructor<T = {}> = new (...args: any[]) => T;

export type PromiseOrSync<T> = Promise<T> | T;
export type PromiseResolveOrSync<T> = T extends Promise<infer U> ? U : T;

export type AllAsyncStageKeys = 'loadResources' | 'finalAuthorize' | 'execute';
export type AllSyncStageKeys =
  | 'extractAmbient'
  | 'extractInputs'
  | 'sanitizeInputs'
  | 'preAuthorize'
  | 'redactResponse';
export type AllStageKeys = AllAsyncStageKeys | AllSyncStageKeys;

export interface OptionallyHasExtractAmbient<TUnsafe, TContextInit> {
  extractAmbient?: (unsafe: TUnsafe) => TContextInit;
}

export interface HasExtractAmbient<TUnsafe, TContextInit> {
  extractAmbient: (unsafe: TUnsafe) => TContextInit;
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

export interface OptionallyHasPreAuthorize<TContextIn, TContextOut> {
  preAuthorize?: (context: TContextIn) => TContextOut;
}

export interface OptionallyHasLoadResources<TContextIn, TContextOut> {
  loadResources?: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface HasLoadResources<TContextIn, TContextOut> {
  loadResources: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface OptionallyHasFinalAuthorize<TContextIn, TContextOut> {
  finalAuthorize?: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface HasFinalAuthorize<TContextIn, TContextOut> {
  finalAuthorize: (context: TContextIn) => PromiseOrSync<TContextOut>;
}

export interface OptionallyHasExecute<TContextIn, TUnsafeResponse> {
  execute?: (context: TContextIn) => PromiseOrSync<TUnsafeResponse>;
}

export interface HasExecute<TContextIn, TUnsafeResponse> {
  execute: (context: TContextIn) => PromiseOrSync<TUnsafeResponse>;
}

// The second parameter is the final lifecycle context (everything execute
// saw), so redaction can depend on e.g. the caller's role without smuggling
// authz flags through the execute return value. The runtime always passes it;
// it is declared optional so existing one-argument call sites keep compiling,
// and TS's parameter-optionality laxity means two-parameter redactors with a
// required, precisely-typed context still satisfy the shape.
export interface OptionallyHasRedactResponse<TUnsafeResponse, TResponse> {
  redactResponse?: (unsafe: TUnsafeResponse, context?: any) => TResponse;
}

export interface HasRedactResponse<TUnsafeResponse, TResponse> {
  redactResponse: (unsafe: TUnsafeResponse, context?: any) => TResponse;
}

export type HasRequiredStages = HasSanitizeInputs<any, any> &
  HasPreAuthorize<any, any> &
  HasFinalAuthorize<any, any> &
  HasExecute<any, any> &
  HasRedactResponse<any, any>;

export type OptionalStagesShape = OptionallyHasExtractAmbient<any, any> &
  OptionallyHasExtractInputs<any, any> &
  OptionallyHasLoadResources<any, any>;

export type HasAllStagesDefined = HasExtractAmbient<any, any> &
  HasExtractInputs<any, any> &
  HasSanitizeInputs<any, any> &
  HasPreAuthorize<any, any> &
  HasLoadResources<any, any> &
  HasFinalAuthorize<any, any> &
  HasExecute<any, any> &
  HasRedactResponse<any, any>;

export type AllStagesOptionalShape = OptionallyHasExtractAmbient<any, any> &
  OptionallyHasExtractInputs<any, any> &
  OptionallyHasSanitizeInputs<any, any> &
  OptionallyHasPreAuthorize<any, any> &
  OptionallyHasLoadResources<any, any> &
  OptionallyHasFinalAuthorize<any, any> &
  OptionallyHasExecute<any, any> &
  OptionallyHasRedactResponse<any, any>;

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
  : TKey extends 'ambient'
    ? HasExtractAmbient<any, TValue>
    : {};

export type PreAuthorizeDepsMet<T extends HasPreAuthorize<any, any>> =
  IntersectProperties<{
    [P in keyof Parameters<T['preAuthorize']>[0]]: ReturnedTypeUpToPreAuthorize<
      Parameters<T['preAuthorize']>[0][P],
      P
    >;
  }>;

type OptionalLoadResourcesParams<T> = [T] extends [HasLoadResources<any, any>]
  ? Parameters<T['loadResources']>[0]
  : {};

type ReturnedSomewhereUpToLoadResources<
  TOut,
  TValue,
  TKey extends string | symbol | number,
> = [TOut] extends [HasPreAuthorize<any, Record<TKey, TValue>>]
  ? HasPreAuthorize<any, Record<TKey, TValue>>
  : never;

type AllInitKeys = 'ambient' | 'inputs';

export type LoadResourcesDepsMet<T> = IntersectProperties<{
  [P in keyof OptionalLoadResourcesParams<T>]: [P] extends [AllInitKeys]
    ? ReturnedTypeUpToPreAuthorize<OptionalLoadResourcesParams<T>[P], P>
    : ReturnedSomewhereUpToLoadResources<
        T,
        OptionalLoadResourcesParams<T>[P],
        P
      >;
}>;

type ReturnedSomewhereUpToFinalAuthorize<
  TOut,
  TValue,
  TKey extends string | symbol | number,
> = [TOut] extends [HasLoadResources<any, Record<TKey, TValue>>]
  ? HasLoadResources<any, Record<TKey, TValue>>
  : [TOut] extends [HasPreAuthorize<any, Record<TKey, TValue>>]
    ? HasPreAuthorize<any, Record<TKey, TValue>>
    : never;

export type FinalAuthorizeDepsMet<T extends HasFinalAuthorize<any, any>> =
  IntersectProperties<{
    [P in keyof Parameters<T['finalAuthorize']>[0]]: [P] extends [AllInitKeys]
      ? ReturnedTypeUpToPreAuthorize<Parameters<T['finalAuthorize']>[0][P], P>
      : ReturnedSomewhereUpToFinalAuthorize<
          T,
          Parameters<T['finalAuthorize']>[0][P],
          P
        >;
  }>;

type OptionalExecuteParams<T> = [T] extends [HasExecute<any, any>]
  ? Parameters<T['execute']>[0]
  : {};

type ReturnedSomewhereUpToExecute<
  TOut,
  TValue,
  TKey extends string | symbol | number,
> = [TOut] extends [HasFinalAuthorize<any, Record<TKey, TValue>>]
  ? HasFinalAuthorize<any, Record<TKey, TValue>>
  : [TOut] extends [HasLoadResources<any, Record<TKey, TValue>>]
    ? HasLoadResources<any, Record<TKey, TValue>>
    : [TOut] extends [HasPreAuthorize<any, Record<TKey, TValue>>]
      ? HasPreAuthorize<any, Record<TKey, TValue>>
      : never;

export type ExecuteDepsMet<T> = IntersectProperties<{
  [P in keyof OptionalExecuteParams<T>]: [P] extends [AllInitKeys]
    ? ReturnedTypeUpToPreAuthorize<OptionalExecuteParams<T>[P], P>
    : ReturnedSomewhereUpToExecute<T, OptionalExecuteParams<T>[P], P>;
}>;

type ReturnedSomewhereUpToRedactResponse<TOut, TValue> = [TOut] extends [
  HasExecute<any, TValue>,
]
  ? HasExecute<any, TValue>
  : never;

// Infers the declared type of a redactor's optional context parameter; for a
// one-parameter redactor this resolves to `unknown` (no context requirements).
type RedactResponseCtxParam<T> = T extends {
  redactResponse: (unsafe: any, context: infer C) => any;
}
  ? C
  : unknown;

export type RedactResponseDepsMet<T extends HasRedactResponse<any, any>> =
  IntersectProperties<{
    [P in keyof Parameters<
      T['redactResponse']
    >[0]]: ReturnedSomewhereUpToRedactResponse<
      T,
      Record<P, Parameters<T['redactResponse']>[0][P]>
    >;
  }> &
    // A two-parameter redactor's declared context keys participate in the
    // deps-met machinery like execute's do (the runtime passes execute's
    // context to redactResponse).
    IntersectProperties<{
      [P in keyof RedactResponseCtxParam<T>]: [P] extends [AllInitKeys]
        ? ReturnedTypeUpToPreAuthorize<RedactResponseCtxParam<T>[P], P>
        : ReturnedSomewhereUpToExecute<T, RedactResponseCtxParam<T>[P], P>;
    }>;
