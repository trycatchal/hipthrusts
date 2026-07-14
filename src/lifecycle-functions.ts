export function ExtractAmbient<
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    extractAmbient: projector,
  };
}

export function ExtractInputs<
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    extractInputs: projector,
  };
}

export function SanitizeInputs<
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    sanitizeInputs: projector,
  };
}

export function PreAuthorize<
  TContextIn extends object,
  TContextOut extends object | boolean,
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    preAuthorize: projector,
  };
}

export function LoadResources<
  TContextIn extends object,
  TContextOut extends object,
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    loadResources: projector,
  };
}

export function FinalAuthorize<
  TContextIn extends object,
  TContextOut extends object | boolean,
>(projector: (htCtx: TContextIn) => TContextOut) {
  return {
    finalAuthorize: projector,
  };
}

export function Execute<TContextIn extends object, TUnsafeResponse>(
  projector: (htCtx: TContextIn) => TUnsafeResponse
) {
  return {
    execute: projector,
  };
}

export function RedactResponse<TUnsafeResponse, TResponse>(
  projector: (unsafe: TUnsafeResponse) => TResponse
) {
  return {
    redactResponse: projector,
  };
}
