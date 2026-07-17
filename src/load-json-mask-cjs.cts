// CJS-build loader for the OPTIONAL json-mask peer — see load-json-mask.ts
// (the ESM variant) for why this is lazy.
export type JsonMaskFn = (obj: any, maskConfig: string) => any;

export function loadJsonMask(): JsonMaskFn {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- this file is only ever built as CommonJS.
    return require('json-mask');
  } catch (cause) {
    throw new Error(
      'dtoSchemaObj requires the optional peer dependency "json-mask" — install it to use schema masking.',
      { cause }
    );
  }
}
