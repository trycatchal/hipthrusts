// Transport-agnostic error hierarchy.
//
// The core lifecycle throws these semantic errors; each adapter translates
// them to its framework-native shape (Boom for express, TRPCError for tRPC,
// etc.). This keeps HTTP/library specifics out of core.

export type HipErrorKind =
  | 'badInputs'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'internal';

export abstract class HipError extends Error {
  public abstract readonly kind: HipErrorKind;
  constructor(message?: string, public readonly detail?: unknown) {
    super(message);
    // Maintain a correct prototype chain when extending a built-in under
    // ES5-targeted transpilation, and give each subclass a useful `name`.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

// Input sanitization / validation failed (untrusted input rejected).
export class HipBadInputs extends HipError {
  public readonly kind = 'badInputs';
}

// No authenticated principal where one is required.
export class HipUnauthorized extends HipError {
  public readonly kind = 'unauthorized';
}

// Authenticated, but not permitted (pre- or final-authorization failed).
export class HipForbidden extends HipError {
  public readonly kind = 'forbidden';
}

// A required resource could not be found.
export class HipNotFound extends HipError {
  public readonly kind = 'notFound';
}

// The request conflicts with current state.
export class HipConflict extends HipError {
  public readonly kind = 'conflict';
}

// Unexpected failure; details should not leak to the caller.
export class HipInternal extends HipError {
  public readonly kind = 'internal';
}

export function isHipError(thing: unknown): thing is HipError {
  return thing instanceof HipError;
}

// Maps a transport-agnostic HipError to an HTTP status code. Used by adapters
// that respond with a raw status + JSON body (Hono, Fastify, Next.js). The
// express adapter maps to Boom instead and does not use this.
export function hipErrorToStatus(error: HipError): number {
  switch (error.kind) {
    case 'badInputs':
      return 422;
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'notFound':
      return 404;
    case 'conflict':
      return 409;
    default:
      return 500;
  }
}

// Control-flow signal, not an error: instructs HTTP-style adapters to issue a
// redirect. Non-HTTP adapters treat it as an internal error.
export class HipRedirect {
  constructor(
    public readonly redirectUrl: string,
    public readonly redirectCode = 302
  ) {}
}
