import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

// tslint:disable-next-line:no-var-requires
const { describe, it } = require('mocha');

import { toExpressHandler, HTPipe, WithInputSlice } from '../src';
import {
  AllAsyncStageKeys,
  AllStageKeys,
  AllStagesOptionalShape,
  HasLoadResources,
  HasExecute,
  HasExtractInputs,
  HasFinalAuthorize,
  HasExtractAmbient,
  HasPreAuthorize,
  HasSanitizeInputs,
  HasRedactResponse,
  PromiseResolveOrSync,
} from '../src/types';

use(chaiAsPromised);

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

  // tslint:disable-next-line:no-unused-expression
  expect(pipedLifecycleStage).to.not.be.eql({});
  if (pipedLifecycleStage) {
    const pipedLifecycleStageResult =
      lifecycleStage === 'loadResources' ||
      lifecycleStage === 'execute' ||
      lifecycleStage === 'finalAuthorize'
        ? await pipedLifecycleStage(pipeIn)
        : pipedLifecycleStage(pipeIn);
    expect(pipedLifecycleStageResult).to.deep.equal(pipeOut);
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

        // tslint:disable-next-line:no-unused-variable
        const triple = HTPipe(left, midNotCovered, rightFullyCovered);
      });

      describe('piped empty objects', () => {
        it('returns equal empty object', () => {
          const pipedWithEmptyObjectsOnly = HTPipe({}, {});

          // tslint:disable-next-line:no-unused-variable
          type assignableToCorrect = {} extends typeof pipedWithEmptyObjectsOnly
            ? true
            : false;
          // tslint:disable-next-line:no-unused-variable
          type assignableFromCorrect = typeof pipedWithEmptyObjectsOnly extends {}
            ? true
            : false;

          expect(pipedWithEmptyObjectsOnly).to.be.eql({});
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
            expect(htCtx.a).to.be.equal(testConstants.aPassedIn);
            return { b: testConstants.bPassedIn };
          };

          const rightProjector = (htCtx: { b: number }) => {
            expect(htCtx.b).to.be.equal(testConstants.bPassedIn);
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
            expect(context).to.deep.equal({
              someObj: { a: aPassedIn, b: bPassedIn },
            });
            return context.someObj;
          },
        };

        const right = {
          sanitizeInputs: (context: { a: string; b: string }) => {
            expect(context).to.not.has.property('someObj');
            expect(context).to.deep.equal({ a: aPassedIn, b: bPassedIn });
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
        expect(out).to.deep.equal({
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
        expect(out).to.deep.equal({
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
        // tslint:disable-next-line:no-unused-expression
        expect(err).to.not.be.undefined;
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
        // tslint:disable-next-line:no-unused-expression
        expect(err).to.not.be.undefined;
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
        // tslint:disable-next-line:no-unused-expression
        expect(err).to.not.be.undefined;
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
        // tslint:disable-next-line:no-unused-expression
        expect(err).to.not.be.undefined;
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
        // tslint:disable-next-line:no-unused-expression
        expect(err).to.not.be.undefined;
      });
    });

    describe('executeHipthrustable end-to-end', () => {
      it('runs the new lifecycle and resolves successStatus', async () => {
        const mod = require('../src/core');
        const executeHipthrustable = mod.executeHipthrustable;
        const withDefaultImplementations = mod.withDefaultImplementations;

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
          successStatus: 201,
        });

        const result = await executeHipthrustable(
          handler,
          { who: 'alice', value: 7 },
          200
        );
        expect(result.response).to.deep.equal({ doubled: 14, by: 'alice' });
        expect(result.status).to.equal(201);
      });

      it('honors successStatus as a function reading the final context', async () => {
        const mod = require('../src/core');
        const executeHipthrustable = mod.executeHipthrustable;
        const withDefaultImplementations = mod.withDefaultImplementations;

        const handler = withDefaultImplementations({
          sanitizeInputs: (unsafe: { create: boolean }) => ({
            create: unsafe.create,
          }),
          preAuthorize: () => true,
          finalAuthorize: () => true,
          execute: (ctx: { inputs: { create: boolean } }) => ({
            created: ctx.inputs.create,
          }),
          redactResponse: (u: { created: boolean }) => ({
            created: u.created,
          }),
          successStatus: (ctx: { response: { created: boolean } }) =>
            ctx.response.created ? 201 : 200,
        });

        const created = await executeHipthrustable(
          handler,
          { create: true },
          200
        );
        expect(created.status).to.equal(201);

        const updated = await executeHipthrustable(
          handler,
          { create: false },
          200
        );
        expect(updated.status).to.equal(200);
      });

      it('falls back to adapter default status when successStatus is absent', async () => {
        const mod = require('../src/core');
        const executeHipthrustable = mod.executeHipthrustable;
        const withDefaultImplementations = mod.withDefaultImplementations;

        const handler = withDefaultImplementations({
          sanitizeInputs: (unsafe: {}) => ({}),
          preAuthorize: () => true,
          finalAuthorize: () => true,
          execute: () => ({ ok: true }),
          redactResponse: (u: { ok: boolean }) => ({ ok: u.ok }),
        });

        const result = await executeHipthrustable(handler, {}, 200);
        expect(result.status).to.equal(200);
      });
    });
  });
});
