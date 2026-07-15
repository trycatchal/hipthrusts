// Transport-agnostic error hierarchy.
//
// The core lifecycle throws these semantic errors; each adapter translates
// them to its transport's shape (an HTTP status + JSON body, or propagation
// for tRPC). This keeps HTTP/library specifics out of core.

export type HipErrorKind =
  | 'badInputs'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'internal';

export interface HipErrorOptions {
  // Chains the underlying failure for logging/debugging (standard Error.cause).
  // Never serialized to clients.
  cause?: unknown;
  // Opt-in to serializing `detail` in HTTP error bodies (see hipErrorToBody).
  // Off by default so unexpected internals stay scrubbed; set it when app code
  // deliberately throws a structured payload the client should render.
  expose?: boolean;
}

export abstract class HipError extends Error {
  public abstract readonly kind: HipErrorKind;
  public readonly exposeDetail: boolean;
  constructor(
    message?: string,
    public readonly detail?: unknown,
    options?: HipErrorOptions
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.exposeDetail = options?.expose === true;
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

// Maps a transport-agnostic HipError to an HTTP status code. Used by every
// adapter that responds with a raw status + JSON body (Express, Hono,
// Fastify, Next.js).
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

// Wire shape for HipError responses across the HTTP adapters.
export interface HipErrorBody {
  error: string;
  // Present when `detail` is a ZodError(-like): paths + messages ONLY, never
  // the received input values (those can contain secrets).
  issues?: { path: (string | number)[]; message: string }[];
  // Present only when the error was constructed with `{ expose: true }`.
  detail?: unknown;
}

// Duck-typed so this works with any zod version (and zod-compatible
// validators) without importing zod into core.
function isZodErrorLike(
  detail: unknown
): detail is { issues: { path?: unknown; message?: unknown }[] } {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    Array.isArray((detail as { issues?: unknown }).issues)
  );
}

// Projects a HipError to the JSON body adapters put on the wire. `detail` is
// NEVER dumped verbatim: a ZodError is reduced to paths + messages, anything
// else requires the explicit `{ expose: true }` opt-in at construction time,
// and HipInternal exposes nothing beyond its message.
export function hipErrorToBody(error: HipError): HipErrorBody {
  const body: HipErrorBody = { error: error.message };
  if (error.kind === 'internal' || error.detail === undefined) {
    return body;
  }
  if (isZodErrorLike(error.detail)) {
    body.issues = error.detail.issues.map((issue) => ({
      path: Array.isArray(issue.path)
        ? issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === 'string' || typeof segment === 'number'
          )
        : [],
      message: typeof issue.message === 'string' ? issue.message : '',
    }));
    return body;
  }
  if (error.exposeDetail) {
    body.detail = error.detail;
  }
  return body;
}

// Control-flow signal, not an error: instructs HTTP-style adapters to issue a
// redirect. Non-HTTP adapters treat it as an internal error.
export class HipRedirect {
  constructor(
    public readonly redirectUrl: string,
    public readonly redirectCode = 302
  ) {}
}
