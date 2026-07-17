import { describe, expect, it } from 'vitest';
import {
  executeHipthrustable,
  finishPipe,
  HipForbidden,
  HTPipe,
  SanitizeInputsSlices,
  withDefaultImplementations,
} from '../src/index.js';

const BasePipe = HTPipe(
  { extractAmbient: (raw: any) => ({ userId: String(raw.userId) }) },
  SanitizeInputsSlices({ params: (p: any) => ({ id: String(p.id) }) }),
  {
    preAuthorize: (ctx: { ambient: { userId: string } }) => ({
      principal: ctx.ambient.userId,
    }),
  },
  { loadResources: () => ({ fromPipe: 'pipe-loaded' }) }
);

describe('finishPipe runtime (plain HTPipe composition)', () => {
  it('runs pipe stages first, handler stages after, merging contributions', async () => {
    const finished = finishPipe(BasePipe, {
      loadResources: (ctx) => ({ doc: `${ctx.fromPipe}:doc` }),
      finalAuthorize: (ctx) => ctx.principal === 'u1',
      execute: (ctx) => ({
        id: ctx.inputs.params.id,
        doc: ctx.doc,
        by: ctx.principal,
      }),
      redactResponse: (unsafe) => ({ id: unsafe.id, doc: unsafe.doc }),
      responseMeta: { status: 201 },
    });

    expect(finished.responseMeta).toEqual({ status: 201 });

    const { response } = await executeHipthrustable(
      withDefaultImplementations(finished as any) as any,
      { userId: 'u1', params: { id: '42' } }
    );
    expect(response).toEqual({ id: '42', doc: 'pipe-loaded:doc' });
  });

  it('handler finalAuthorize denial is a HipForbidden like any piped stage', async () => {
    const finished = finishPipe(BasePipe, {
      finalAuthorize: (ctx) => ctx.principal === 'someone-else',
      execute: () => ({ ok: true }),
      redactResponse: (unsafe) => unsafe,
    });
    await expect(
      executeHipthrustable(withDefaultImplementations(finished as any) as any, {
        userId: 'u1',
        params: { id: '42' },
      })
    ).rejects.toThrow(HipForbidden);
  });

  it('chains the handler redactor after the pipe redactor', async () => {
    const pipeWithRedact = HTPipe(BasePipe, {
      redactResponse: (unsafe: any) => ({ ...unsafe, pipeRedacted: true }),
    });
    const finished = finishPipe(pipeWithRedact, {
      finalAuthorize: () => true,
      execute: () => ({ secret: 's', name: 'n' }),
      redactResponse: (unsafe: any) => ({
        name: unsafe.name,
        sawPipeRedaction: unsafe.pipeRedacted === true,
      }),
    });
    const { response } = await executeHipthrustable(
      withDefaultImplementations(finished as any) as any,
      { userId: 'u1', params: { id: '1' } }
    );
    expect(response).toEqual({ name: 'n', sawPipeRedaction: true });
  });
});
