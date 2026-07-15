import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { HipBadInputs, HipNotFound } from '../src/errors';
import { htMongooseFactory } from '../src/mongoose';

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
