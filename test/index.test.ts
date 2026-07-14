import Boom from '@hapi/boom';
import { describe, expect, it } from 'vitest';

import { HTPipe, WithInputSlice } from '../src';
import { executeHipthrustable, withDefaultImplementations } from '../src/core';
import { HipForbidden } from '../src/errors';
import { toExpressHandler } from '../src/express';
import {
  AllAsyncStageKeys,
  AllStageKeys,
  AllStagesOptionalShape,
  HasExecute,
  HasExtractAmbient,
  HasExtractInputs,
  HasFinalAuthorize,
  HasLoadResources,
  HasPreAuthorize,
  HasRedactResponse,
  HasSanitizeInputs,
  PromiseResolveOrSync,
} from '../src/types';

type ReturnTypeFromStage<
  T extends (context: any) => any,
  TStage extends AllStageKeys
> = TStage extends AllAsyncStageKeys
  ? PromiseResolveOrSync<ReturnType<T>>
  : ReturnType<T>;

async function HTPipeTest<
  TPipe extends AllStagesOptionalShape,
  TPipeIn,
  TPipeOut,
  TStage extends AllStageKeys,
  TLifecycleStage extends TStage extends 'extractAmbient'
    ? TPipe extends HasExtractAmbient<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'extractInputs'
    ? TPipe extends HasExtractInputs<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'sanitizeInputs'
    ? TPipe extends HasSanitizeInputs<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'preAuthorize'
    ? TPipe extends HasPreAuthorize<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'loadResources'
    ? TPipe extends HasLoadResources<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'finalAuthorize'
    ? TPipe extends HasFinalAuthorize<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'execute'
    ? TPipe extends HasExecute<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'redactResponse'
    ? TPipe extends HasRedactResponse<any, any>
      ? TPipe[TStage]
      : never
    : never,
  TValid extends TPipeInExpected extends Parameters<TLifecycleStage>[0]
    ? Parameters<TLifecycleStage>[0] extends TPipeInExpected
      ? TPipeOutExpected extends ReturnTypeFromStage<TLifecycleStage, TStage>
        ? ReturnTypeFromStage<TLifecycleStage, TStage> extends TPipeOutExpected
          ? true
          : never
        : never
      : never
    : never,
  TPipeInExpected = TPipeIn,
  TPipeOutExpected = TPipeOut
>(
  pipe: TPipe,
  lifecycleStage: TStage,
  pipeIn: TPipeIn,
  pipeOut: TPipeOut,
  valid: TValid
) {
  const pipedLifecycleStage = pipe[lifecycleStage];

  expect(pipedLifecycleStage).not.toEqual({});
  if (pipedLifecycleStage) {
    const pipedLifecycleStageResult =
      lifecycleStage === 'loadResources' ||
      lifecycleStage === 'execute' ||
      lifecycleStage === 'finalAuthorize'
        ? await pipedLifecycleStage(pipeIn)
        : pipedLifecycleStage(pipeIn);
    expect(pipedLifecycleStageResult).toEqual(pipeOut);
  }
}

describe('HipThrusTS', () => {
  describe('Hipthrusts functional', () => {
    describe('HTPipeTest', () => {
      it('passes with correct params', async () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;

        await HTPipeTest(
          {
            loadResources: (context: { a: string }) => {
              return {
                aOut: context.a,
                c: cReturned,
                b: bReturned,
              };
            },
          },
          'loadResources',
          { a: aPassedIn },
          { aOut: aPassedIn, b: bReturned, c: cReturned },
          true
        );
      });
    });

    describe('HTPipe', () => {
      it('works with three operators', () => {
        const left = {
          loadResources(context: { a: string }) {
            return { b: 4 };
          },
        };

        const midNotCovered = {
          loadResources(context: { d: number }) {
            return { e: 4 };
          },
        };

        const rightFullyCovered = {
          loadResources(context: { b: number }) {
            return { c: 4 };
          },
        };

        const triple = HTPipe(left, midNotCovered, rightFullyCovered);
      });

      describe('piped empty objects', () => {
        it('returns equal empty object', () => {
          const pipedWithEmptyObjectsOnly = HTPipe({}, {});

          type assignableToCorrect = {} extends typeof pipedWithEmptyObjectsOnly
            ? true
            : false;
          type assignableFromCorrect = typeof pipedWithEmptyObjectsOnly extends {}
            ? true
            : false;

          expect(pipedWithEmptyObjectsOnly).toEqual({});
        });
      });

      describe('fully covered left and right with correct types', () => {
        function caseFor<TStage extends AllStageKeys>(stage: TStage) {
          const testConstants = {
            aPassedIn: 'some string',
            bPassedIn: 4,
            cReturned: 6,
          };

          const leftProjector = (htCtx: { a: string }) => {
            expect(htCtx.a).toBe(testConstants.aPassedIn);
            return { b: testConstants.bPassedIn };
          };

          const rightProjector = (htCtx: { b: number }) => {
            expect(htCtx.b).toBe(testConstants.bPassedIn);
            return { c: testConstants.cReturned };
          };

          const testInput = {
            a: testConstants.aPassedIn,
          };

          const testOutput = {
            b: testConstants.bPassedIn,
            c: testConstants.cReturned,
          };

          return {
            left: {
              [stage]: leftProjector,
            } as Record<TStage, typeof leftProjector>,
            right: {
              [stage]: rightProjector,
            } as Record<TStage, typeof rightProjector>,
            testInput,
            testOutput,
          };
        }

        it('extractAmbient', async () => {
          const lifecycleStage = 'extractAmbient';
          await HTPipeTest(
            HTPipe(caseFor(lifecycleStage).left, caseFor(lifecycleStage).right),
            lifecycleStage,
            caseFor(lifecycleStage).testInput,
            caseFor(lifecycleStage).testOutput,
            true
          );
        });
        it('extractInputs', async () => {
          const lifecycleStage = 'extractInputs';
          await HTPipeTest(
            HTPipe(caseFor(lifecycleStage).left, caseFor(lifecycleStage).right),
            lifecycleStage,
            caseFor(lifecycleStage).testInput,
            caseFor(lifecycleStage).testOutput,
            true
          );
        });
        it('loadResources sync', async () => {
          const lifecycleStage = 'loadResources';
          await HTPipeTest(
            HTPipe(caseFor(lifecycleStage).left, caseFor(lifecycleStage).right),
            lifecycleStage,
            caseFor(lifecycleStage).testInput,
            caseFor(lifecycleStage).testOutput,
            true
          );
        });
      });
    });

    describe('sanitizeInputs filtration functionality', () => {
      it('chained sanitizers filter as expected', async () => {
        const aPassedIn = 'some string';
        const bPassedIn = 'some other string';

        const left = {
          sanitizeInputs: (context: { someObj: { a: string; b: string } }) => {
            expect(context).toEqual({
              someObj: { a: aPassedIn, b: bPassedIn },
            });
            return context.someObj;
          },
        };

        const right = {
          sanitizeInputs: (context: { a: string; b: string }) => {
            expect(context).not.toHaveProperty('someObj');
            expect(context).toEqual({ a: aPassedIn, b: bPassedIn });
            return { b: context.b };
          },
        };

        await HTPipeTest(
          HTPipe(left, right),
          'sanitizeInputs',
          { someObj: { a: aPassedIn, b: bPassedIn } },
          { b: bPassedIn },
          true
        );
      });
    });

    describe('redactResponse filtration functionality', () => {
      it('chained sanitizers filter as expected', async () => {
        const aPassedIn = 'some string';
        const bPassedIn = 'some other string';

        const left = {
          redactResponse: (context: {
            someObj: { a: string; b: string };
          }) => {
            return context.someObj;
          },
        };

        const right = {
          redactResponse: (context: { a: string; b: string }) => {
            return { b: context.b };
          },
        };

        await HTPipeTest(
          HTPipe(left, right),
          'redactResponse',
          { someObj: { a: aPassedIn, b: bPassedIn } },
          { b: bPassedIn },
          true
        );
      });
    });

    describe('WithInputSlice', () => {
      it('writes to sanitizeInputs under named slice and preserves others', () => {
        const params = WithInputSlice('params', (p: { id: string }) => ({
          id: p.id.trim(),
        }));
        const out = params.sanitizeInputs({
          params: { id: '  abc  ' },
          body: { keep: true },
          query: {},
          headers: {},
        });
        expect(out).toEqual({
          params: { id: 'abc' },
          body: { keep: true },
          query: {},
          headers: {},
        });
      });

      it('composes with HTPipe so multiple slices coexist', () => {
        const both = HTPipe(
          WithInputSlice('params', (p: { id: string }) => ({ id: p.id })),
          WithInputSlice('body', (b: { name: string }) => ({
            name: b.name.toUpperCase(),
          }))
        );
        const out = both.sanitizeInputs({
          params: { id: '42' },
          body: { name: 'foo' },
          query: { ignored: true },
          headers: {},
        });
        expect(out).toEqual({
          params: { id: '42' },
          body: { name: 'FOO' },
          query: { ignored: true },
          headers: {},
        });
      });
    });

    describe('toExpressHandler', () => {
      it('passes with all correct lifecycle stages present', () => {
        const handlingStrategy = {
          extractAmbient() {
            return {};
          },
          sanitizeInputs(unsafe: {
            params: { ting?: number };
            body: { ting?: number };
          }) {
            return {
              params: { ting: 5 as number },
              body: { ting: 5 as number },
            };
          },
          preAuthorize(context: {
            inputs: { params: { ting: number }; body: { ting: number } };
          }) {
            return { asdf: { ting: 4 } };
          },
          loadResources(context: { asdf: { ting: number } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          execute(context: {}) {
            return { result: 1 };
          },
          redactResponse(unsafe: { result: number }) {
            return { result: unsafe.result };
          },
        };
        toExpressHandler(handlingStrategy);
      });

      it('errors when sanitizeInputs is missing at type level', () => {
        const handlingStrategy = {
          preAuthorize(context: {}) {
            return { b: 5 };
          },
          loadResources(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: {}) {
            return true;
          },
          execute(context: {}) {
            return {};
          },
          redactResponse(unsafe: {}) {
            return {};
          },
        };
        let err: any;
        try {
          // @ts-expect-error
          toExpressHandler(handlingStrategy);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
      });

      it('errors when preAuthorize is missing', () => {
        const handlingStrategy = {
          sanitizeInputs(unsafe: {}) {
            return {};
          },
          loadResources(context: {}) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          execute(context: {}) {
            return {};
          },
          redactResponse(unsafe: {}) {
            return {};
          },
        };
        let err: any;
        try {
          // @ts-expect-error
          toExpressHandler(handlingStrategy);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
      });

      it('errors when finalAuthorize is missing', () => {
        const handlingStrategy = {
          sanitizeInputs(unsafe: {}) {
            return {};
          },
          preAuthorize(context: {}) {
            return { b: 5 };
          },
          loadResources(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          execute(context: {}) {
            return {};
          },
          redactResponse(unsafe: {}) {
            return {};
          },
        };
        let err: any;
        try {
          // @ts-expect-error
          toExpressHandler(handlingStrategy);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
      });

      it('errors when execute is missing', () => {
        const handlingStrategy = {
          sanitizeInputs(unsafe: {}) {
            return {};
          },
          preAuthorize(context: {}) {
            return { b: 5 };
          },
          loadResources(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: {}) {
            return true;
          },
          redactResponse(unsafe: {}) {
            return {};
          },
        };
        let err: any;
        try {
          // @ts-expect-error
          toExpressHandler(handlingStrategy);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
      });

      it('errors when redactResponse is missing', () => {
        const handlingStrategy = {
          sanitizeInputs(unsafe: {}) {
            return {};
          },
          preAuthorize(context: {}) {
            return { b: 5 };
          },
          loadResources(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: {}) {
            return true;
          },
          execute(context: {}) {
            return {};
          },
        };
        let err: any;
        try {
          // @ts-expect-error
          toExpressHandler(handlingStrategy);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
      });
    });

    describe('toExpressHandler responseMeta + error translation', () => {
      function fakeRes(): any {
        return {
          statusCode: 200,
          headers: {} as Record<string, string>,
          body: undefined as any,
          redirectedTo: undefined as string | undefined,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(b: any) {
            this.body = b;
            return this;
          },
          setHeader(k: string, v: string) {
            this.headers[k] = v;
          },
          redirect(code: number, url: string) {
            this.statusCode = code;
            this.redirectedTo = url;
          },
        };
      }
      const rawReq = { params: {}, query: {}, body: {}, headers: {} };

      it('applies static responseMeta status and headers', async () => {
        const handler = toExpressHandler({
          sanitizeInputs: (i: any) => i,
          preAuthorize: () => true,
          finalAuthorize: () => true,
          execute: () => ({ id: '1' }),
          redactResponse: (u: { id: string }) => ({ id: u.id }),
          responseMeta: { status: 201, headers: { Location: '/things/1' } },
        });
        const res = fakeRes();
        await handler(rawReq as any, res, (() => undefined) as any);
        expect(res.statusCode).toBe(201);
        expect(res.headers.Location).toBe('/things/1');
        expect(res.body).toEqual({ id: '1' });
      });

      it('computes responseMeta status from the final context', async () => {
        const handler = toExpressHandler({
          sanitizeInputs: (i: { body: { created: boolean } }) => ({
            created: i.body.created,
          }),
          preAuthorize: () => true,
          finalAuthorize: () => true,
          execute: (ctx: { inputs: { created: boolean } }) => ({
            created: ctx.inputs.created,
          }),
          redactResponse: (u: { created: boolean }) => ({ created: u.created }),
          responseMeta: (ctx: { response: { created: boolean } }) => ({
            status: ctx.response.created ? 201 : 200,
          }),
        });

        const resCreated = fakeRes();
        await handler(
          { ...rawReq, body: { created: true } } as any,
          resCreated,
          (() => undefined) as any
        );
        expect(resCreated.statusCode).toBe(201);

        const resUpdated = fakeRes();
        await handler(
          { ...rawReq, body: { created: false } } as any,
          resUpdated,
          (() => undefined) as any
        );
        expect(resUpdated.statusCode).toBe(200);
      });

      it('translates a denied authorization to a Boom 403 via next', async () => {
        const handler = toExpressHandler({
          sanitizeInputs: (i: any) => i,
          preAuthorize: () => false,
          finalAuthorize: () => true,
          execute: () => ({}),
          redactResponse: (u: any) => u,
        });
        let nextErr: any;
        const res = fakeRes();
        await handler(rawReq as any, res, ((e: any) => {
          nextErr = e;
        }) as any);
        expect(nextErr).toBeDefined();
        expect(Boom.isBoom(nextErr)).toBe(true);
        expect(nextErr.output.statusCode).toBe(403);
      });
    });

    describe('executeHipthrustable end-to-end', () => {
      it('runs the lifecycle and returns the response plus final context', async () => {
        const handler = withDefaultImplementations({
          extractAmbient: (raw: { who: string }) => ({ who: raw.who }),
          extractInputs: (raw: any) => raw,
          sanitizeInputs: (unsafe: { value: number }) => ({
            value: unsafe.value * 2,
          }),
          preAuthorize: () => true,
          finalAuthorize: () => true,
          execute: (ctx: {
            inputs: { value: number };
            ambient: { who: string };
          }) => ({ doubled: ctx.inputs.value, by: ctx.ambient.who }),
          redactResponse: (u: { doubled: number; by: string }) => ({
            doubled: u.doubled,
            by: u.by,
          }),
        });

        const result = await executeHipthrustable(handler, {
          who: 'alice',
          value: 7,
        });
        expect(result.response).toEqual({ doubled: 14, by: 'alice' });
        // The final context is returned for adapters (status/headers, etc.).
        expect(result.context.response).toEqual({
          doubled: 14,
          by: 'alice',
        });
        expect(result.context.ambient).toEqual({ who: 'alice' });
      });

      it('treats an empty object from finalAuthorize as a pass', async () => {
        const handler = withDefaultImplementations({
          sanitizeInputs: (unsafe: {}) => ({}),
          preAuthorize: () => ({}),
          finalAuthorize: () => ({}),
          execute: () => ({ ok: true }),
          redactResponse: (u: { ok: boolean }) => ({ ok: u.ok }),
        });

        const result = await executeHipthrustable(handler, {});
        expect(result.response).toEqual({ ok: true });
      });

      it('throws a HipForbidden when finalAuthorize denies', async () => {
        const handler = withDefaultImplementations({
          sanitizeInputs: (unsafe: {}) => ({}),
          preAuthorize: () => true,
          finalAuthorize: () => false,
          execute: () => ({ ok: true }),
          redactResponse: (u: { ok: boolean }) => ({ ok: u.ok }),
        });

        await expect(
          executeHipthrustable(handler, {})
        ).rejects.toThrow(HipForbidden);
      });
    });
  });
});
