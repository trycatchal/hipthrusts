// Type-level tests for the everyday mongoose loader fragments: ctxRef paths
// derive real deps-met requirements (zero hand-written ctx annotations), and
// lean reads carry `_id`.
import type { Model, Types } from 'mongoose';
import { describe, expectTypeOf, it } from 'vitest';
import { HTPipe, SanitizeInputsSlices } from '../src/index.js';
import type { CtxRef, SpecReq } from '../src/mongoose.js';
import {
  ctxRef,
  LoadByIdRequiredTo,
  LoadDocByIdRequiredTo,
  LoadManyTo,
  LoadOneTo,
} from '../src/mongoose.js';
import { toNextHandler } from '../src/next.js';

interface User {
  email: string;
  name: string;
}
const UserModel = {} as unknown as Model<User>;

const requiredTail = {
  preAuthorize: () => true,
  finalAuthorize: () => true,
  redactResponse: (u: any) => u,
};

describe('ctxRef-derived requirements', () => {
  it('compiles when an earlier stage provides the referenced path', () => {
    const handler = toNextHandler(
      HTPipe(
        SanitizeInputsSlices({ body: (b: any) => ({ user: String(b.user) }) }),
        LoadOneTo(UserModel, 'user', { _id: ctxRef('inputs.body.user') }),
        {
          ...requiredTail,
          execute: (ctx: {
            user: (User & { _id: Types.ObjectId }) | null;
          }) => ({ email: ctx.user?.email }),
        }
      )
    );
    expectTypeOf(handler).toBeFunction();
  });

  it('fails deps-met when nothing provides the referenced path', () => {
    // Only `params` is sanitized; the spec references `inputs.body.user`.
    const conf = {
      sanitizeInputs: (i: any) => ({ params: { id: String(i.params.id) } }),
      ...requiredTail,
      ...LoadOneTo(UserModel, 'user', { _id: ctxRef('inputs.body.user') }),
      execute: (ctx: { user: (User & { _id: Types.ObjectId }) | null }) => ({
        email: ctx.user?.email,
      }),
    };
    // @ts-expect-error - no provider for inputs.body.user
    toNextHandler(conf);
  });

  it('literal (non-ref) spec values contribute no requirements', () => {
    const frag = LoadManyTo(UserModel, 'users', { name: 'fixed' });
    // Callable with an empty context: the literal spec demanded nothing.
    const out = frag.loadResources({});
    expectTypeOf(out).resolves.toEqualTypeOf<
      Record<'users', (User & { _id: Types.ObjectId })[]>
    >();
  });

  it('the selector-function overload keeps its declared ctx requirement', () => {
    const frag = LoadManyTo(UserModel, 'users', (ctx: { tenant: string }) => ({
      tenant: ctx.tenant,
    }));
    expectTypeOf(frag.loadResources)
      .parameter(0)
      .toEqualTypeOf<{ tenant: string }>();
  });
});

describe('lean and hydrated result typing', () => {
  it('LoadManyTo types rows as lean docs WITH _id', () => {
    const frag = LoadManyTo(UserModel, 'users');
    type Out = Awaited<ReturnType<typeof frag.loadResources>>;
    expectTypeOf<Out['users'][number]['_id']>().toEqualTypeOf<Types.ObjectId>();
    expectTypeOf<Out['users'][number]['email']>().toEqualTypeOf<string>();
  });

  it('LoadOneTo types the row as lean doc or null', () => {
    const frag = LoadOneTo(UserModel, 'user', {
      email: ctxRef('inputs.body.email'),
    });
    type Out = Awaited<ReturnType<typeof frag.loadResources>>;
    expectTypeOf<Out['user']>().toEqualTypeOf<
      (User & { _id: Types.ObjectId }) | null
    >();
  });

  it('LoadByIdRequiredTo types the row as a NON-nullable lean doc', () => {
    const frag = LoadByIdRequiredTo(
      UserModel,
      'user',
      ctxRef('inputs.params.id')
    );
    type Out = Awaited<ReturnType<typeof frag.loadResources>>;
    expectTypeOf<Out['user']['_id']>().toEqualTypeOf<Types.ObjectId>();
    // The ctxRef path became the fragment's context requirement.
    expectTypeOf(frag.loadResources)
      .parameter(0)
      .toEqualTypeOf<{ inputs: { params: { id: unknown } } }>();
  });

  it('LoadDocByIdRequiredTo types the row as a hydrated document', () => {
    const frag = LoadDocByIdRequiredTo(
      UserModel,
      'userDoc',
      ctxRef('inputs.params.id')
    );
    type Out = Awaited<ReturnType<typeof frag.loadResources>>;
    // Hydrated documents carry mongoose instance methods like save().
    expectTypeOf<Out['userDoc']['save']>().toBeFunction();
  });
});

// Exported so alternative loader flavors can derive the same deps-met
// requirement from a filter spec without restating the mapped type.
describe('SpecReq (exported spec-requirement mapper)', () => {
  it('combines every ctxRef path into one nested requirement; literals add nothing', () => {
    type Req = SpecReq<{
      _id: CtxRef<'inputs.body.user'>;
      status: { $in: string[] }; // literal — contributes no requirement
      org: CtxRef<'inputs.params.orgId'>;
    }>;
    expectTypeOf<Req>().toMatchTypeOf<{
      inputs: { body: { user: unknown }; params: { orgId: unknown } };
    }>();
  });

  it('a spec with no ctxRefs requires nothing', () => {
    // No ctxRefs => no required keys (the `{}` empty requirement).
    expectTypeOf<keyof SpecReq<{ status: string }>>().toEqualTypeOf<never>();
  });
});
