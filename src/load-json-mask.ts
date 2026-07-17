// ESM-build loader for the OPTIONAL json-mask peer (only dtoSchemaObj needs
// it). Loaded lazily at first use so consumers of the finders/fragments never
// need json-mask installed. The CJS build uses load-json-mask-cjs.cts instead
// (tshy dialect switching).
import { createRequire } from 'node:module';

export type JsonMaskFn = (obj: any, maskConfig: string) => any;

export function loadJsonMask(): JsonMaskFn {
  try {
    // The CJS build swaps in load-json-mask-cjs.cts but still TYPECHECKS this
    // file, so import.meta needs @ts-ignore there while being error-free in
    // the ESM pass (which is why it can't be @ts-expect-error).
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const requireFromHere = createRequire(import.meta.url);
    return requireFromHere('json-mask');
  } catch (cause) {
    throw new Error(
      'dtoSchemaObj requires the optional peer dependency "json-mask" — install it to use schema masking.',
      { cause }
    );
  }
}
