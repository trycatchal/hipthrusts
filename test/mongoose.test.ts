import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { HipBadInputs, HipNotFound } from '../src/errors';
import {
  ctxRef,
  FindScoped,
  htMongooseFactory,
  isCtxRef,
  LoadByIdRequiredTo,
  LoadDocByIdRequiredTo,
  LoadManyTo,
  LoadOneTo,
} from '../src/mongoose';

// Everything here runs against real mongoose but WITHOUT a database
// connection: schema construction, document instantiation, and validateSync
// are all connection-free, and the finder helpers accept anything shaped
// like a model.
const ht = htMongooseFactory(mongoose);

describe('findByIdRequired', () => {
  const doc = { name: 'found' };
  const model = {
    findById: (_id: string) => ({ exec: async () => doc }),
  };

  it('returns the document when found', async () => {
    await expect(ht.findByIdRequired(model)('someid')).resolves.toBe(doc);
  });

  it('throws HipBadInputs when the id is missing', async () => {
    await expect(ht.findByIdRequired(model)('')).rejects.toThrow(HipBadInputs);
  });

  it('throws HipNotFound when the lookup returns null', async () => {
    const empty = { findById: () => ({ exec: async () => null }) };
    await expect(ht.findByIdRequired(empty)('someid')).rejects.toThrow(
      HipNotFound
    );
  });
});

describe('findOneByRequired', () => {
  it('wraps the value in $eq to block query-object injection', async () => {
    let seenQuery: any;
    const model = {
      findOne: (query: any) => {
        seenQuery = query;
        return { exec: async () => ({ ok: true }) };
      },
    };
    await ht.findOneByRequired(model, 'email')('a@b.c');
    expect(seenQuery).toEqual({ email: { $eq: 'a@b.c' } });
  });

  it('throws HipBadInputs when the value is missing', async () => {
    const model = { findOne: () => ({ exec: async () => null }) };
    await expect(ht.findOneByRequired(model, 'email')('')).rejects.toThrow(
      HipBadInputs
    );
  });

  it('throws HipNotFound when nothing matches', async () => {
    const model = { findOne: () => ({ exec: async () => null }) };
    await expect(ht.findOneByRequired(model, 'email')('a@b.c')).rejects.toThrow(
      HipNotFound
    );
  });
});

describe('SanitizeInputsWithMongoose', () => {
  const factory = ht.documentFactoryFromForRequest({
    name: { type: String, required: true },
  });

  it('returns a plain object for valid inputs', () => {
    const { sanitizeInputs } = ht.SanitizeInputsWithMongoose(factory);
    expect(sanitizeInputs({ name: 'hip' })).toEqual({ name: 'hip' });
  });

  it('throws HipBadInputs when required fields are missing', () => {
    const { sanitizeInputs } = ht.SanitizeInputsWithMongoose(factory);
    expect(() => sanitizeInputs({})).toThrow(HipBadInputs);
  });

  it('strips fields not in the schema', () => {
    const { sanitizeInputs } = ht.SanitizeInputsWithMongoose(factory);
    expect(sanitizeInputs({ name: 'hip', evil: 'x' } as any)).toEqual({
      name: 'hip',
    });
  });
});

describe('SanitizeInputsSlicesWithMongoose', () => {
  const factory = ht.documentFactoryFromForRequest({
    id: { type: String, required: true },
  });

  it('sanitizes the named slice; unnamed slices are not named keys', () => {
    const { sanitizeInputs } = ht.SanitizeInputsSlicesWithMongoose({
      params: factory,
    });
    const result = sanitizeInputs({
      params: { id: '7' },
      body: { untouched: true },
    });
    expect(result.params).toEqual({ id: '7' });
    expect(Object.keys(result)).toEqual(['params']);
  });

  it('throws HipBadInputs naming the slice when invalid', () => {
    const { sanitizeInputs } = ht.SanitizeInputsSlicesWithMongoose({
      params: factory,
    });
    expect(() => sanitizeInputs({ params: {} })).toThrow('params not valid');
  });
});

describe('toObject shape pinning under ambient mongoose config (#110)', () => {
  // Global toObject config is baked into schemas at construction time, so the
  // override must be in place BEFORE the factory creates its schema — the
  // realistic ordering for app-level config set at boot.
  function withGlobalToObject<T>(options: object, fn: () => T): T {
    const prior = mongoose.get('toObject');
    mongoose.set('toObject', options as any);
    try {
      return fn();
    } finally {
      mongoose.set('toObject', prior as any);
    }
  }

  it('SanitizeInputsWithMongoose ignores a global getters/virtuals override', () => {
    withGlobalToObject({ getters: true, virtuals: true }, () => {
      const factory = ht.documentFactoryFromForRequest({
        name: {
          type: String,
          required: true,
          get: (v: string) => `GETTER:${v}`,
        },
      });
      const { sanitizeInputs } = ht.SanitizeInputsWithMongoose(factory);
      expect(sanitizeInputs({ name: 'hip' })).toEqual({ name: 'hip' });
    });
  });

  it('SanitizeInputsSlicesWithMongoose ignores a global getters/virtuals override', () => {
    withGlobalToObject({ getters: true, virtuals: true }, () => {
      const sliceFactory = ht.documentFactoryFromForRequest({
        id: { type: String, required: true, get: (v: string) => `GETTER:${v}` },
      });
      const { sanitizeInputs } = ht.SanitizeInputsSlicesWithMongoose({
        params: sliceFactory,
      });
      expect(sanitizeInputs({ params: { id: '7' } }).params).toEqual({
        id: '7',
      });
    });
  });

  it('RedactResponseWithMongoose ignores a global getters/virtuals override', () => {
    withGlobalToObject({ getters: true, virtuals: true }, () => {
      const factory = ht.documentFactoryFromForResponse({
        name: { type: String, get: (v: string) => `GETTER:${v}` },
      });
      const { redactResponse } = ht.RedactResponseWithMongoose(factory);
      const result = redactResponse({ name: 'x' }) as any;
      expect(result.name).toBe('x');
    });
  });
});

describe('SaveOnDocumentFrom', () => {
  it('saves the document found on the context key', async () => {
    const { execute } = ht.SaveOnDocumentFrom('doc');
    const saved = { fresh: true };
    await expect(execute({ doc: { save: async () => saved } })).resolves.toBe(
      saved
    );
  });

  it('throws HipBadInputs when save rejects', async () => {
    const { execute } = ht.SaveOnDocumentFrom('doc');
    const failing = {
      save: async () => {
        throw new Error('validation failed');
      },
    };
    await expect(execute({ doc: failing })).rejects.toThrow(HipBadInputs);
  });

  it('throws HipBadInputs when the document is missing', async () => {
    const { execute } = ht.SaveOnDocumentFrom('doc');
    await expect(execute({})).rejects.toThrow(HipBadInputs);
  });
});

describe('UpdateDocumentFromTo', () => {
  it('reads new data from inputs.body by default', async () => {
    let seen: any;
    const doc = { set: async (data: any) => (seen = data) };
    const { execute } = ht.UpdateDocumentFromTo('doc');
    await execute({ doc, inputs: { body: { name: 'updated' } } });
    expect(seen).toEqual({ name: 'updated' });
  });

  it('supports a custom dot-path data key', async () => {
    let seen: any;
    const doc = { set: async (data: any) => (seen = data) };
    const { execute } = ht.UpdateDocumentFromTo('doc', 'patch');
    await execute({ doc, patch: { name: 'patched' } });
    expect(seen).toEqual({ name: 'patched' });
  });

  it('throws HipBadInputs when the document is missing', async () => {
    const { execute } = ht.UpdateDocumentFromTo('doc');
    await expect(execute({ inputs: { body: {} } } as any)).rejects.toThrow(
      HipBadInputs
    );
  });
});

describe('PojoToDocument', () => {
  it('constructs the model from the pojo and stores it under the new key', () => {
    class FakeModel {
      constructor(public readonly pojo: any) {}
    }
    const { loadResources } = ht.PojoToDocument('raw', FakeModel, 'doc');
    const out = loadResources({ raw: { a: 1 } }) as { doc: FakeModel };
    expect(out.doc).toBeInstanceOf(FakeModel);
    expect(out.doc.pojo).toEqual({ a: 1 });
  });
});

describe('RedactResponseWithMongoose', () => {
  it('projects the unsafe response through the response schema', () => {
    const factory = ht.documentFactoryFromForResponse({
      name: { type: String },
    });
    const { redactResponse } = ht.RedactResponseWithMongoose(factory);
    const result = redactResponse({ name: 'hip', secret: 'x' }) as any;
    expect(result.name).toBe('hip');
    expect(result.secret).toBeUndefined();
  });
});

describe('dtoSchemaObj', () => {
  it('masks the schema config and wipes defaults', () => {
    const source = {
      name: { type: String, default: 'anon' },
      secret: { type: String },
    };
    expect(ht.dtoSchemaObj(source, 'name')).toEqual({
      name: { type: String },
    });
  });
});

describe('findScoped / loadScopedTo (Finding P2-10)', () => {
  const rows = [
    { _id: '1', tenant: 'a', name: 'a-one' },
    { _id: '2', tenant: 'a', name: 'a-two' },
    { _id: '3', tenant: 'b', name: 'b-one' },
  ];
  const FakeModel = {
    find(filter: Record<string, any>) {
      return {
        exec: async () =>
          rows.filter((row) =>
            Object.entries(filter).every(([k, v]) =>
              v && typeof v === 'object' && Array.isArray(v.$in)
                ? v.$in.includes((row as any)[k])
                : (row as any)[k] === v
            )
          ),
      };
    },
  };

  it('findScoped loads scoped rows on the LOAD stage and its execute returns them', async () => {
    const frag = ht.findScoped(FakeModel);
    const loaded = await frag.loadResources({
      queryScope: { tenant: { $in: ['a'] } },
    });
    expect(loaded.scopedDocs.map((r: any) => r.name)).toEqual([
      'a-one',
      'a-two',
    ]);
    expect(frag.execute({ ...loaded })).toBe(loaded.scopedDocs);
  });

  it('findScoped merges an extra filter and honors a custom docs key', async () => {
    const frag = ht.findScoped(FakeModel, { name: 'a-two' }, 'items');
    const loaded = await frag.loadResources({
      queryScope: { tenant: { $in: ['a'] } },
    });
    expect(frag.execute({ ...loaded }).map((r: any) => r.name)).toEqual([
      'a-two',
    ]);
  });

  it('loadScopedTo stores the scoped rows under the given key', async () => {
    const { loadResources } = ht.loadScopedTo(FakeModel, 'items');
    const out: any = await loadResources({
      queryScope: { tenant: { $in: ['b'] } },
    });
    expect(out.items.map((r: any) => r.name)).toEqual(['b-one']);
  });
});

// A chainable fake query capturing every call, for loader/options assertions.
function fakeQuery(result: any) {
  const calls: Record<string, any[]> = {};
  const query: any = { calls };
  for (const method of ['sort', 'skip', 'limit', 'lean']) {
    query[method] = (...args: any[]) => {
      calls[method] = args;
      return query;
    };
  }
  query.exec = async () => result;
  return query;
}

describe('isCtxRef (exported ctxRef marker guard)', () => {
  it('recognizes a ctxRef and narrows to its path, rejecting everything else', () => {
    const ref = ctxRef('inputs.body.user');
    expect(isCtxRef(ref)).toBe(true);
    if (isCtxRef(ref)) {
      // narrows to CtxRef — .path is readable without a cast
      expect(ref.path).toBe('inputs.body.user');
    }
    for (const notARef of [
      null,
      undefined,
      {},
      { path: 'inputs.body.user' },
      'inputs.body.user',
      42,
    ]) {
      expect(isCtxRef(notARef)).toBe(false);
    }
  });

  it('matches a marker minted from the shared Symbol.for registry (cross-copy interop)', () => {
    // An alternative loader flavor that never imported ctxRef but stamps the
    // same registered symbol is still recognized — the point of exporting it.
    const foreign = {
      [Symbol.for('hipthrusts.ctxRef')]: true,
      path: 'inputs.params.id',
    };
    expect(isCtxRef(foreign)).toBe(true);
  });
});

describe('everyday loaders: ctxRef filter specs', () => {
  it('LoadOneTo $eq-wraps ctxRef values, passes literals verbatim, prunes undefined', async () => {
    let seenFilter: any;
    let lastQuery: any;
    const model: any = {
      findOne(filter: any) {
        seenFilter = filter;
        lastQuery = fakeQuery({ email: 'a@b.c' });
        return lastQuery;
      },
    };
    const { loadResources } = LoadOneTo(model, 'user', {
      _id: ctxRef('inputs.body.user'),
      status: { $in: ['active', 'invited'] },
      missing: ctxRef('inputs.body.nope'),
      alsoMissing: undefined,
    });
    const out: any = await loadResources({
      inputs: { body: { user: 'u1' } },
    } as any);
    expect(seenFilter).toEqual({
      _id: { $eq: 'u1' },
      status: { $in: ['active', 'invited'] },
    });
    expect(lastQuery.calls.lean).toEqual([]);
    expect(out.user).toEqual({ email: 'a@b.c' });
  });

  it('LoadManyTo resolves the spec and stores the lean rows', async () => {
    let seenFilter: any;
    const rows = [{ name: 'one' }, { name: 'two' }];
    const model: any = {
      find(filter: any) {
        seenFilter = filter;
        return fakeQuery(rows);
      },
    };
    const { loadResources } = LoadManyTo(model, 'things', {
      businessGroup: ctxRef('inputs.params.businessGroupId'),
    });
    const out: any = await loadResources({
      inputs: { params: { businessGroupId: 'bg1' } },
    } as any);
    expect(seenFilter).toEqual({ businessGroup: { $eq: 'bg1' } });
    expect(out.things).toBe(rows);
  });

  it('the selector-function overload passes its computed filter verbatim', async () => {
    let seenFilter: any;
    const model: any = {
      find(filter: any) {
        seenFilter = filter;
        return fakeQuery([]);
      },
    };
    const { loadResources } = LoadManyTo(
      model,
      'rows',
      (ctx: { tenantIds: string[] }) => ({ tenant: { $in: ctx.tenantIds } })
    );
    await loadResources({ tenantIds: ['a', 'b'] });
    expect(seenFilter).toEqual({ tenant: { $in: ['a', 'b'] } });
  });
});

describe('everyday loaders: required-by-id variants', () => {
  const found = { name: 'thing' };
  function modelWithFindById(result: any) {
    let leanCalled = false;
    return {
      leanCalled: () => leanCalled,
      findById(_id: any) {
        const query = fakeQuery(result);
        const origLean = query.lean;
        query.lean = (...args: any[]) => {
          leanCalled = true;
          return origLean(...args);
        };
        return query;
      },
    } as any;
  }

  it('LoadByIdRequiredTo loads lean and stores under the key', async () => {
    const model = modelWithFindById(found);
    const { loadResources } = LoadByIdRequiredTo(
      model,
      'thing',
      ctxRef('inputs.params.id')
    );
    const out: any = await loadResources({
      inputs: { params: { id: 'x1' } },
    } as any);
    expect(out.thing).toBe(found);
    expect(model.leanCalled()).toBe(true);
  });

  it('LoadByIdRequiredTo throws HipNotFound (custom message) when missing', async () => {
    const { loadResources } = LoadByIdRequiredTo(
      modelWithFindById(null),
      'thing',
      ctxRef('inputs.params.id'),
      'No such thing'
    );
    await expect(
      loadResources({ inputs: { params: { id: 'x1' } } } as any)
    ).rejects.toThrow(new HipNotFound('No such thing'));
  });

  it('LoadByIdRequiredTo rejects missing and object-smuggled ids as HipBadInputs', async () => {
    const { loadResources } = LoadByIdRequiredTo(
      modelWithFindById(found),
      'thing',
      ctxRef('inputs.params.id')
    );
    await expect(
      loadResources({ inputs: { params: {} } } as any)
    ).rejects.toThrow(HipBadInputs);
    await expect(
      loadResources({ inputs: { params: { id: { $ne: null } } } } as any)
    ).rejects.toThrow(HipBadInputs);
  });

  it('LoadDocByIdRequiredTo loads HYDRATED (no lean) and 404s when missing', async () => {
    const model = modelWithFindById(found);
    const { loadResources } = LoadDocByIdRequiredTo(
      model,
      'thingDoc',
      ctxRef('inputs.params.id')
    );
    const out: any = await loadResources({
      inputs: { params: { id: 'x1' } },
    } as any);
    expect(out.thingDoc).toBe(found);
    expect(model.leanCalled()).toBe(false);

    const emptyModel = modelWithFindById(null);
    const { loadResources: loadMissing } = LoadDocByIdRequiredTo(
      emptyModel,
      'thingDoc',
      (ctx: any) => ctx.inputs.params.id
    );
    await expect(
      loadMissing({ inputs: { params: { id: 'x1' } } } as any)
    ).rejects.toThrow(HipNotFound);
  });
});

describe('scoped finder query options', () => {
  it('applies sort/skip/limit/lean and a projection to the scoped query', async () => {
    let seenFilter: any;
    let seenProjection: any;
    let lastQuery: any;
    const model: any = {
      find(filter: any, projection?: any) {
        seenFilter = filter;
        seenProjection = projection;
        lastQuery = fakeQuery([{ name: 'row' }]);
        return lastQuery;
      },
    };
    const frag = FindScoped(
      model,
      { archived: false },
      {
        docsKey: 'items',
        sort: { createdAt: -1 },
        skip: 5,
        limit: 100,
        lean: true,
        projection: { name: 1 },
      }
    );
    const loaded: any = await frag.loadResources({
      queryScope: { tenant: { $eq: 't1' } },
    });
    expect(seenFilter).toEqual({
      tenant: { $eq: 't1' },
      archived: false,
    });
    expect(seenProjection).toEqual({ name: 1 });
    expect(lastQuery.calls).toEqual({
      sort: [{ createdAt: -1 }],
      skip: [5],
      limit: [100],
      lean: [],
    });
    expect(frag.execute(loaded)).toEqual([{ name: 'row' }]);
  });

  it('keeps the bare-string docsKey back-compat form', async () => {
    const model: any = { find: () => fakeQuery([{ name: 'r' }]) };
    const frag = FindScoped(model, undefined, 'items');
    const loaded: any = await frag.loadResources({ queryScope: {} });
    expect(loaded.items).toEqual([{ name: 'r' }]);
  });
});
