// json-mask ships no type declarations; minimal ambient typing for our usage.
declare module 'json-mask' {
  function mask(obj: unknown, maskStr: string): any;
  export default mask;
}
