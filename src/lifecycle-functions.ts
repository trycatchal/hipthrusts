export function InitPreContext<
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    initPreContext: projector,
  };
}

export function ExtractInputs<
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    extractInputs: projector,
  };
}

export function SanitizeInputs<
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    sanitizeInputs: projector,
  };
}

export function PreAuthorize<
  TContextIn extends object,
  TContextOut extends object | boolean
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    preAuthorize: projector,
  };
}

export function AttachData<
  TContextIn extends object,
  TContextOut extends object
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    attachData: projector,
  };
}

export function FinalAuthorize<
  TContextIn extends object,
  TContextOut extends object | boolean
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    finalAuthorize: projector,
  };
}

export function DoWork<TContextIn extends object, TUnsafeResponse>(
  projector: (htCtx: TContextIn) => TUnsafeResponse
) {
  return {
    doWork: projector,
  };
}

export function SanitizeResponse<TUnsafeResponse, TResponse>(
  projector: (unsafe: TUnsafeResponse) => TResponse
) {
  return {
    sanitizeResponse: projector,
  };
}
