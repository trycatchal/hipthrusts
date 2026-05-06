import { describe, it, expect } from 'vitest';
import { hipExpressHandlerFactory, HTPipe } from '../src';
import {
  AllAsyncStageKeys,
  AllStageKeys,
  HasAllStagesOptionals,
  HasAttachData,
  HasDoWork,
  HasFinalAuthorize,
  HasInitPreContext,
  HasPreAuthorize,
  HasRespond,
  HasSanitizeBody,
  HasSanitizeParams,
  HasSanitizeQueryParams,
  HasSanitizeResponse,
  PromiseResolveOrSync,
} from '../src/types';

interface MockUser {
  _id: string;
  email: string;
}

type ReturnTypeFromStage<
  T extends (context: any) => any,
  TStage extends AllStageKeys
> = TStage extends AllAsyncStageKeys
  ? PromiseResolveOrSync<ReturnType<T>>
  : ReturnType<T>;

async function HTPipeTest<
  TPipe extends HasAllStagesOptionals,
  TPipeIn,
  TPipeOut,
  TStage extends AllStageKeys,
  TLifecycleStage extends TStage extends 'initPreContext'
    ? TPipe extends HasInitPreContext<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'sanitizeParams'
    ? TPipe extends HasSanitizeParams<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'sanitizeQueryParams'
    ? TPipe extends HasSanitizeQueryParams<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'sanitizeBody'
    ? TPipe extends HasSanitizeBody<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'preAuthorize'
    ? TPipe extends HasPreAuthorize<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'attachData'
    ? TPipe extends HasAttachData<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'finalAuthorize'
    ? TPipe extends HasFinalAuthorize<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'doWork'
    ? TPipe extends HasDoWork<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'respond'
    ? TPipe extends HasRespond<any, any>
      ? TPipe[TStage]
      : never
    : TStage extends 'sanitizeResponse'
    ? TPipe extends HasSanitizeResponse<any, any>
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
  expect(pipedLifecycleStage).not.toEqual({});
  if (pipedLifecycleStage) {
    const pipedLifecycleStageResult =
      lifecycleStage === 'attachData' ||
      lifecycleStage === 'doWork' ||
      lifecycleStage === 'finalAuthorize'
        ? await pipedLifecycleStage(pipeIn)
        : pipedLifecycleStage(pipeIn);
    expect(pipedLifecycleStageResult).toEqual(pipeOut);
  }
}

describe('HipThrusTS', () => {
  /*
  describe('HipThrusTS declarative', () => {
    describe('WithInit', () => {
      class Base {
        public existingField = 'Hyrule';
        constructor(...args: any[]) {
          // empty - tslint shutup
        }
      }
      const AddUserFromReqUser = WithInit(
        'user',
        (user: MockUser) => user,
        'user_user'
      );

      const UserAddedRequest = AddUserFromReqUser(Base);

      const req = { user: { _id: 'link', email: 'link@example.com' } };
      const hipRequestInstance = new UserAddedRequest(req);
      it('attaches a properly typed member to all request instances', () => {
        // tslint:disable-next-line:prefer-const
        let isToMockUserTypeOkay: typeof hipRequestInstance.user_user extends MockUser
          ? true
          : false;
        let isFromMockUserTypeOkay: MockUser extends typeof hipRequestInstance.user_user
          ? true
          : false;
        // @ts-expect-error
        isToMockUserTypeOkay = false;
        // @ts-expect-error
        isFromMockUserTypeOkay = false;

        // tslint:disable-next-line:prefer-const
        let fromMockUserIdTypeIsOkay: typeof hipRequestInstance.user_user._id extends string
          ? true
          : false;
        // @ts-expect-error
        fromMockUserIdTypeIsOkay = false;

        // tslint:disable-next-line:prefer-const
        let mockUserEmailTypeIsOkay: typeof hipRequestInstance.user_user.email extends string
          ? true
          : false;
        // @ts-expect-error
        mockUserEmailTypeIsOkay = false;

        expect(hipRequestInstance.user_user.email).toBe(
          'link@example.com'
        );
      });
      it('retains the base class members', () => {
        // tslint:disable-next-line:prefer-const
        let existingFieldTypeIsOkay: typeof hipRequestInstance.existingField extends string
          ? true
          : false;
        // @ts-expect-error
        existingFieldTypeIsOkay = false;

        expect(hipRequestInstance.existingField).toBe('Hyrule');
      });
    });
    describe('WithAttached', () => {
      const AddThingIdFromParams = WithAttached(
        'params',
        (params: { id: string }) => Promise.resolve(params.id),
        'thingId'
      );

      // todo: add test to ensure synchronous projectors are rejected
      // todo: add test to check for race conditions

      it('compile-time-errors-out when extending a class that lacks the right member', () => {
        class BaseWithoutParams {
          public existingField = 'Hyrule';
          constructor(...args: any[]) {
            // empty - tslint shutup
          }
        }
        // @todo: fix like the HTPipeOld stuff (no assign) - this may not actually work!
        // tslint:disable-next-line:prefer-const
        let typeFromBaseWithoutParamsIsOkay: typeof BaseWithoutParams extends Parameters<
          typeof AddThingIdFromParams
        >[0]
          ? true
          : false = false;
        let typeToBaseWithoutParamsIsOkay: Parameters<
          typeof AddThingIdFromParams
        >[0] extends typeof BaseWithoutParams
          ? true
          : false = false;
        // @ts-expect-error
        typeFromBaseWithoutParamsIsOkay = true;
        // @ts-expect-error
        typeToBaseWithoutParamsIsOkay = true;
      });
      it('compile-time-errors-out when extending a class that has the right member but it does not satisfy the projector', () => {
        class BaseWithMistypedParams {
          public existingField = 'Hyrule';
          public params = {};
          constructor(...args: any[]) {
            // empty - tslint shutup
          }
        }
        // @todo: fix like the HTPipeOld stuff (no assign) - this may not actually work!
        // tslint:disable-next-line:prefer-const
        let typeFromBaseWithMistypedParamsIsOkay: typeof BaseWithMistypedParams extends Parameters<
          typeof AddThingIdFromParams
        >[0]
          ? true
          : false = false;
        let typeToBaseWithMistypedParamsIsOkay: Parameters<
          typeof AddThingIdFromParams
        >[0] extends typeof BaseWithMistypedParams
          ? true
          : false = false;
        // @ts-expect-error
        typeFromBaseWithMistypedParamsIsOkay = true;
        // @ts-expect-error
        typeToBaseWithMistypedParamsIsOkay = true;
      });
      describe('with a proper superclass', () => {
        class BaseWithProperParams {
          public existingField = 'Hyrule';
          public params = { id: 'stringy', somethingelse: 1986 };
          constructor(...args: any[]) {
            // empty - tslint shutup
          }
        }
        it('pleases the compiler', () => {
          // @todo: fix like the HTPipeOld stuff (no assign) - this may not actually work!
          // tslint:disable-next-line:prefer-const
          let typeIsOkay: typeof BaseWithProperParams extends Parameters<
            typeof AddThingIdFromParams
          >[0]
            ? true
            : false = true;
          // @ts-expect-error
          typeIsOkay = false;
        });
        describe('when wrapping it and creating an instance', () => {
          const RequestWithParamId = AddThingIdFromParams(BaseWithProperParams);

          const req = {};
          const requestWithParamId = new RequestWithParamId(req);
          it('news up an instance with the new member typed properly', () => {
            // tslint:disable-next-line:prefer-const
            let thingIdTypeIsOkay: typeof requestWithParamId.thingId extends string
              ? true
              : false;
            // @ts-expect-error
            thingIdTypeIsOkay = false;
          });
          it('news up instances that retain the base class members and type them properly', () => {
            // tslint:disable-next-line:prefer-const
            let thingIdTypeIsOkay: typeof requestWithParamId.existingField extends string
              ? true
              : false;
            // @ts-expect-error
            thingIdTypeIsOkay = false;

            expect(requestWithParamId.existingField).toBe('Hyrule');
          });
          it('news up instances that have the attachData lifecycle stage', () => {
            // tslint:disable-next-line:prefer-const
            let thingIdFromTypeIsOkay: ReturnType<
              typeof requestWithParamId.attachData
            > extends Promise<any>
              ? true
              : false = true;
            let thingIdToTypeIsOkay: Promise<any> extends ReturnType<
              typeof requestWithParamId.attachData
            >
              ? true
              : false = true;
            // @ts-expect-error
            thingIdFromTypeIsOkay = false;
            // @ts-expect-error
            thingIdToTypeIsOkay = false;
          });
          describe('after calling attachData', () => {
            it('news up instances that can call the attachData lifecycle stage', async () => {
              await requestWithParamId.attachData();
              expect(requestWithParamId.thingId).toBe('stringy');
            });
          });
        });
      });
    });
    describe('htPipe', () => {
      interface Grandparent {
        gName: string;
        parent: {
          pName: string;
          child: {
            name: string;
            age: number;
          };
        };
      }
      const AddWholeFamily = HTPipeOld(
        WithAttached(
          'grandparent',
          (grandparent: Grandparent) => Promise.resolve(grandparent.parent),
          'parent'
        ),
        WithAttached(
          'parent',
          parent => Promise.resolve(parent.child),
          'child'
        ),
        WithAttached(
          'grandparent',
          grandparent => Promise.resolve(grandparent.gName),
          'gName'
        ),
        WithAttached(
          'child',
          (child: { name: string; age: number; boyfriend: string }) =>
            Promise.resolve(child.age),
          'childAge'
        )
      );
      class BaseWithProperParams {
        public grandparent = {
          favFood: 'Veggies',
          gName: 'Gramps',
          parent: {
            child: { name: 'Zelda', age: 33, boyfriend: 'Link' },
            pName: 'Daphnes',
          },
        };
        public existingField = 'Hyrule';
        constructor(...args: any[]) {
          // empty - tslint shutup
        }
      }
      const HappyFamily = AddWholeFamily(BaseWithProperParams);
      const happyFamily = new HappyFamily();
      it('gets properly typed members from all composers', () => {
        // these two are to ensure it's not "any" :-/
        // do NOT assign the next one!  TS is too smart for its own good
        // tslint:disable-next-line:prefer-const
        let isTypedRightFromChildAge: typeof happyFamily.childAge extends number
          ? true
          : false = true;
        // tslint:disable-next-line:prefer-const
        let isTypedRightToChildAge: number extends typeof happyFamily.childAge
          ? true
          : false = true;
        // @ts-expect-error
        isTypedRightFromChildAge = false;
        // @ts-expect-error
        isTypedRightToChildAge = false;
        // just make sure the other two exist cause the above ensures they're properly typed
        let happyFamilyParentExistType: typeof happyFamily.parent extends any
          ? true
          : false;
        let happyFamilyChildExistType: typeof happyFamily.child extends any
          ? true
          : false;
        // @ts-expect-error
        happyFamilyParentExistType = false;
        // @ts-expect-error
        happyFamilyChildExistType = false;
      });
      it('gets all members after attachData() is called', async () => {
        await happyFamily.attachData();
        expect(happyFamily.childAge).toBe(33);
      });
    });
  });
*/
  describe('Hipthrusts functional only', () => {
    // @todo: add test coverage for non-explicit-type-specification too!
    // @todo: add test coverage for SINGLE-OPERATOR and ZERO-OPERATOR pipes
    // @todo: add test coverage for TRIPLE-OPERATOR pipes
    // @todo: add test coverage for QUADRUPLE-AND-MORE-OPERATOR pipes (use empty objects)
    // @todo: add test coverage for multi-stage operators
    describe('HTPipeTest', () => {
      it('HTPipeTest should pass with correct params', async () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;

        await HTPipeTest(
          {
            attachData: (context: { a: string }) => {
              return {
                aOut: context.a,
                c: cReturned,
                b: bReturned,
              };
            },
          },
          'attachData',
          { a: aPassedIn },
          { aOut: aPassedIn, b: bReturned, c: cReturned },
          true
        );
      });
      it('should give error if pipeIn type has more inputs params than lifecycle stage context in type', () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;

        async function HTPipeTypeMismatchTest() {
          await HTPipeTest(
            {
              attachData: (context: { a: string }) => {
                return {
                  c: cReturned,
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: aPassedIn, other: 'some other string' },
            { b: bReturned, c: cReturned },
            // @ts-expect-error
            true
          );
        }
      });
      it('should give error if pipeIn type has less inputs params than lifecycle stage context in type', () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;

        async function HTPipeTypeMismatchTest() {
          await HTPipeTest(
            {
              attachData: (context: { a: string; z: number }) => {
                return {
                  c: cReturned,
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: aPassedIn },
            { b: bReturned, c: cReturned },
            // @ts-expect-error
            true
          );
        }
      });
      it('should give error if pipeOut has more return values than lifecycle stage context out type', () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;

        async function HTPipeTypeMismatchTest() {
          await HTPipeTest(
            {
              attachData: (context: { a: string }) => {
                return {
                  c: cReturned,
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: aPassedIn },
            { b: bReturned, c: cReturned, other: 'some string' },
            // @ts-expect-error
            true
          );
        }
      });
      it('should give error if pipeOut has less return values than lifecycle stage context out type', () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;

        async function HTPipeTypeMismatchTest() {
          await HTPipeTest(
            {
              attachData: (context: { a: string }) => {
                return {
                  c: cReturned,
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: aPassedIn },
            { b: bReturned },
            // @ts-expect-error
            true
          );
        }
      });
      it('should give error if pipeIn has same count of keys as lifecycle stage context in, and pipe out has same count of keys as lifecycle stage context out, but pipeIn key values has different types', () => {
        const incorrectAValue = 3;
        const bReturned = 4;

        async function HTPipeTypeMismatchTest() {
          await HTPipeTest(
            {
              attachData: (context: { a: string }) => {
                return {
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: incorrectAValue },
            { b: bReturned },
            // @ts-expect-error
            true
          );
        }
      });
      it('should give error if pipeIn has same count of keys as lifecycle stage context in, and pipe out has same count of keys as lifecycle stage context out, but pipeOut key values has different types', () => {
        const aPassedIn = 'some string';
        const bReturned = 4;

        async function HTPipeTypeMismatchTest() {
          await HTPipeTest(
            {
              attachData: (context: { a: string }) => {
                return {
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: aPassedIn },
            { b: 'string' },
            // @ts-expect-error
            true
          );
        }
      });
      it('should give error if pipeIn and PipeOut have correct types, but return data of lifecycle stage have different values than pipeOut', async () => {
        const aPassedIn = 'some string';
        const bReturned = 4;
        const cReturned = 6;
        const incorrectCReturned = 12;

        let errorReturned;

        try {
          await HTPipeTest(
            {
              attachData: (context: { a: string }) => {
                return {
                  c: cReturned,
                  b: bReturned,
                };
              },
            },
            'attachData',
            { a: aPassedIn },
            { b: bReturned, c: incorrectCReturned },
            true
          );
        } catch (err) {
          errorReturned = err;
        }
        // tslint:disable-next-line:no-unused-expression
        expect(errorReturned).toBeDefined();
      });
    });
    describe('HTPipe', () => {
      it('works with three operators', () => {
        const left = {
          attachData(context: { a: string }) {
            return { b: 4 };
          },
        };

        const midNotCovered = {
          attachData(context: { d: number }) {
            return { e: 4 };
          },
        };

        const rightFullyCovered = {
          attachData(context: { b: number }) {
            return { c: 4 };
          },
        };

        const triple = HTPipe(left, midNotCovered, rightFullyCovered);
      });

      function wrapProjectorReturnWithPromise<
        TContextIn,
        TContextOut,
        TStage extends AllStageKeys
      >(
        lifecycle: {
          [key in TStage]: (htCtx: TContextIn) => TContextOut;
        },
        lifecycleStage: TStage
      ) {
        return {
          [lifecycleStage]: (htCtx: TContextIn) =>
            Promise.resolve(lifecycle[lifecycleStage](htCtx)),
        } as Record<
          TStage,
          (
            htCtx: Parameters<typeof lifecycle[TStage]>[0]
          ) => Promise<ReturnType<typeof lifecycle[TStage]>>
        >;
      }

      describe('fully covered left and right params with correct types', () => {
        function fullyCoveredCaseTest<TStage extends AllStageKeys>(
          stage: TStage
        ) {
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

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          await HTPipeTest(
            HTPipe(
              fullyCoveredCaseTest(lifecycleStage).left,
              fullyCoveredCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            fullyCoveredCaseTest(lifecycleStage).testInput,
            fullyCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData test sync', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              fullyCoveredCaseTest(lifecycleStage).left,
              fullyCoveredCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            fullyCoveredCaseTest(lifecycleStage).testInput,
            fullyCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData test async', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              wrapProjectorReturnWithPromise(
                fullyCoveredCaseTest(lifecycleStage).left,
                lifecycleStage
              ),
              wrapProjectorReturnWithPromise(
                fullyCoveredCaseTest(lifecycleStage).right,
                lifecycleStage
              )
            ),
            lifecycleStage,
            fullyCoveredCaseTest(lifecycleStage).testInput,
            fullyCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
      });

      describe('successfully handles the same key returned from left and right but with the type transformed', () => {
        function transformedTypeCaseTest<TStage extends AllStageKeys>(
          stage: TStage
        ) {
          const testConstants = {
            aPassedIn: 5,
            bPassedIn: 'some string',
            bReturned: 4,
          };

          const leftProjector = (htCtx: { a: number }) => {
            expect(htCtx.a).toBe(testConstants.aPassedIn);
            return { b: testConstants.bPassedIn };
          };

          const rightProjector = (htCtx: { b: string }) => {
            expect(htCtx.b).toBe(testConstants.bPassedIn);
            return { b: testConstants.bReturned };
          };

          const testInput = {
            a: testConstants.aPassedIn,
          };

          const testOutput = {
            b: testConstants.bReturned,
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

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          await HTPipeTest(
            HTPipe(
              transformedTypeCaseTest(lifecycleStage).left,
              transformedTypeCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            transformedTypeCaseTest(lifecycleStage).testInput,
            transformedTypeCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData sync', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              transformedTypeCaseTest(lifecycleStage).left,
              transformedTypeCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            transformedTypeCaseTest(lifecycleStage).testInput,
            transformedTypeCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData async', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              wrapProjectorReturnWithPromise(
                transformedTypeCaseTest(lifecycleStage).left,
                lifecycleStage
              ),
              wrapProjectorReturnWithPromise(
                transformedTypeCaseTest(lifecycleStage).right,
                lifecycleStage
              )
            ),
            lifecycleStage,
            transformedTypeCaseTest(lifecycleStage).testInput,
            transformedTypeCaseTest(lifecycleStage).testOutput,
            true
          );
        });
      });

      describe('not fully covered tests with left and right params with correct types', () => {
        function notFullyCoveredCaseTest<TStage extends AllStageKeys>(
          stage: TStage
        ) {
          const testConstants = {
            aPassedIn: 'some string',
            bReturned: 4,
            otherPassedIn: 'other string',
            cReturned: 6,
          };

          const leftProjector = (htCtx: { a: string }) => {
            expect(htCtx.a).toBe(testConstants.aPassedIn);
            return { b: testConstants.bReturned };
          };

          const rightProjector = (context: { b: number; other: string }) => {
            expect(context.other).toBe(testConstants.otherPassedIn);
            expect(context.b).toBe(testConstants.bReturned);
            return { c: testConstants.cReturned };
          };

          const testInput = {
            a: testConstants.aPassedIn,
            other: testConstants.otherPassedIn,
          };

          const testOutput = {
            b: testConstants.bReturned,
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

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          await HTPipeTest(
            HTPipe(
              notFullyCoveredCaseTest(lifecycleStage).left,
              notFullyCoveredCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            notFullyCoveredCaseTest(lifecycleStage).testInput,
            notFullyCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData sync', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              notFullyCoveredCaseTest(lifecycleStage).left,
              notFullyCoveredCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            notFullyCoveredCaseTest(lifecycleStage).testInput,
            notFullyCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData async', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              wrapProjectorReturnWithPromise(
                notFullyCoveredCaseTest(lifecycleStage).left,
                lifecycleStage
              ),
              wrapProjectorReturnWithPromise(
                notFullyCoveredCaseTest(lifecycleStage).right,
                lifecycleStage
              )
            ),
            lifecycleStage,
            notFullyCoveredCaseTest(lifecycleStage).testInput,
            notFullyCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
      });

      describe('not covered tests with left and right params with correct types', async () => {
        function notCoveredCaseTest<TStage extends AllStageKeys>(
          stage: TStage
        ) {
          const testConstants = {
            aPassedIn: 'some string',
            otherPassedIn: 'other string',
            bReturned: 4,
            cReturned: 6,
          };

          const leftProjector = (htCtx: { a: string }) => {
            expect(htCtx.a).toBe(testConstants.aPassedIn);
            return { b: testConstants.bReturned };
          };

          const rightProjector = (htCtx: { other: string }) => {
            expect(htCtx.other).toBe(testConstants.otherPassedIn);
            return { c: testConstants.cReturned };
          };

          const testInput = {
            a: testConstants.aPassedIn,
            other: testConstants.otherPassedIn,
          };

          const testOutput = {
            b: testConstants.bReturned,
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

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          await HTPipeTest(
            HTPipe(
              notCoveredCaseTest(lifecycleStage).left,
              notCoveredCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            notCoveredCaseTest(lifecycleStage).testInput,
            notCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData sync', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              notCoveredCaseTest(lifecycleStage).left,
              notCoveredCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            notCoveredCaseTest(lifecycleStage).testInput,
            notCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData async', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              wrapProjectorReturnWithPromise(
                notCoveredCaseTest(lifecycleStage).left,
                lifecycleStage
              ),
              wrapProjectorReturnWithPromise(
                notCoveredCaseTest(lifecycleStage).right,
                lifecycleStage
              )
            ),
            lifecycleStage,
            notCoveredCaseTest(lifecycleStage).testInput,
            notCoveredCaseTest(lifecycleStage).testOutput,
            true
          );
        });
      });

      describe('only left parameter test case', async () => {
        function leftOnlyCaseTest<TStage extends AllStageKeys>(stage: TStage) {
          const testConstants = {
            aPassedIn: 'some string',
            bReturned: 4,
          };

          const leftProjector = (htCtx: { a: string }) => {
            expect(htCtx.a).toBe(testConstants.aPassedIn);
            return { b: testConstants.bReturned };
          };

          const rightProjector = {};

          const testInput = {
            a: testConstants.aPassedIn,
          };

          const testOutput = {
            b: testConstants.bReturned,
          };

          return {
            left: {
              [stage]: leftProjector,
            } as Record<TStage, typeof leftProjector>,
            right: rightProjector,
            testInput,
            testOutput,
          };
        }

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          await HTPipeTest(
            HTPipe(
              leftOnlyCaseTest(lifecycleStage).left,
              leftOnlyCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            leftOnlyCaseTest(lifecycleStage).testInput,
            leftOnlyCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData sync', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              leftOnlyCaseTest(lifecycleStage).left,
              leftOnlyCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            leftOnlyCaseTest(lifecycleStage).testInput,
            leftOnlyCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData async', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              wrapProjectorReturnWithPromise(
                leftOnlyCaseTest(lifecycleStage).left,
                lifecycleStage
              ),
              leftOnlyCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            leftOnlyCaseTest(lifecycleStage).testInput,
            leftOnlyCaseTest(lifecycleStage).testOutput,
            true
          );
        });
      });

      describe('only right parameter test case', () => {
        function rightOnlyCaseTest<TStage extends AllStageKeys>(stage: TStage) {
          const testConstants = {
            bPassedIn: 5,
            otherPassedIn: 'other string',
            cReturned: 4,
          };

          const leftProjector = {};

          const rightProjector = (htCtx: { b: number; other: string }) => {
            expect(htCtx.b).toBe(testConstants.bPassedIn);
            expect(htCtx.other).toBe(testConstants.otherPassedIn);
            return { c: testConstants.cReturned };
          };

          const testInput = {
            b: testConstants.bPassedIn,
            other: testConstants.otherPassedIn,
          };

          const testOutput = {
            c: testConstants.cReturned,
          };

          return {
            left: leftProjector,
            right: {
              [stage]: rightProjector,
            } as Record<TStage, typeof rightProjector>,
            testInput,
            testOutput,
          };
        }

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          await HTPipeTest(
            HTPipe(
              rightOnlyCaseTest(lifecycleStage).left,
              rightOnlyCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            rightOnlyCaseTest(lifecycleStage).testInput,
            rightOnlyCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData sync', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              rightOnlyCaseTest(lifecycleStage).left,
              rightOnlyCaseTest(lifecycleStage).right
            ),
            lifecycleStage,
            rightOnlyCaseTest(lifecycleStage).testInput,
            rightOnlyCaseTest(lifecycleStage).testOutput,
            true
          );
        });
        it('attachData async', async () => {
          const lifecycleStage = 'attachData';
          await HTPipeTest(
            HTPipe(
              rightOnlyCaseTest(lifecycleStage).left,
              wrapProjectorReturnWithPromise(
                rightOnlyCaseTest(lifecycleStage).right,
                lifecycleStage
              )
            ),
            lifecycleStage,
            rightOnlyCaseTest(lifecycleStage).testInput,
            rightOnlyCaseTest(lifecycleStage).testOutput,
            true
          );
        });
      });

      describe('type error test case', () => {
        function errorCaseTest<TStage extends AllStageKeys>(stage: TStage) {
          const testConstants = {
            bReturned: 'bad',
            cReturned: 4,
          };

          const leftProjector = (htCtx: { a: string }) => {
            return { b: testConstants.bReturned };
          };

          const rightProjector = (htCtx: { b: number }) => {
            return { c: testConstants.cReturned };
          };

          return {
            left: {
              [stage]: leftProjector,
            } as Record<TStage, typeof leftProjector>,
            right: {
              [stage]: rightProjector,
            } as Record<TStage, typeof rightProjector>,
          };
        }

        it('initPreContext test', async () => {
          const lifecycleStage = 'initPreContext';
          function expectErrorWithHTPipe() {
            // @ts-expect-error
            const pipedError = HTPipe(
              errorCaseTest(lifecycleStage).left,
              errorCaseTest(lifecycleStage).right
            );
          }
        });
        it('attachData sync - no attaches data when left sync outputs have type mismatch with right inputs', () => {
          const lifecycleStage = 'attachData';
          function expectErrorWithHTPipe() {
            // @ts-expect-error
            const pipedError = HTPipe(
              errorCaseTest(lifecycleStage).left,
              errorCaseTest(lifecycleStage).right
            );
          }
        });
        it('attachData async', async () => {
          const lifecycleStage = 'attachData';
          function expectErrorWithHTPipe() {
            // @ts-expect-error
            const pipedError = HTPipe(
              wrapProjectorReturnWithPromise(
                errorCaseTest(lifecycleStage).left,
                lifecycleStage
              ),
              wrapProjectorReturnWithPromise(
                errorCaseTest(lifecycleStage).right,
                lifecycleStage
              )
            );
          }
        });
      });

      describe('piped empty objects test case', () => {
        it('piped should be equal empty object', () => {
          const pipedWithEmptyObjectsOnly = HTPipe({}, {});

          type assignableToCorrect = {} extends typeof pipedWithEmptyObjectsOnly
            ? true
            : false;
          type assignableFromCorrect = typeof pipedWithEmptyObjectsOnly extends {}
            ? true
            : false;
          // @ts-expect-error
          const assignableToCorrect: assignableToCorrect = false;
          // @ts-expect-error
          const assignableFromCorrect: assignableFromCorrect = false;

          expect(pipedWithEmptyObjectsOnly).toEqual({});
        });
      });
    });
    describe('sanitizers filtration functionality', () => {
      function sanitizersFiltrationTestData<
        TStage extends
          | 'sanitizeParams'
          | 'sanitizeQueryParams'
          | 'sanitizeBody'
          | 'sanitizeResponse'
      >(stage: TStage) {
        const testConstants = {
          aPassedIn: 'some string',
          bPassedIn: 'some other string',
        };

        const leftProjector = (context: {
          someObj: { a: string; b: string };
        }) => {
          expect(context).toEqual({
            someObj: {
              a: testConstants.aPassedIn,
              b: testConstants.bPassedIn,
            },
          });
          return context.someObj;
        };

        const rightProjector = (context: { a: string; b: string }) => {
          expect(context).not.toHaveProperty('someObj');
          expect(context).toEqual({
            a: testConstants.aPassedIn,
            b: testConstants.bPassedIn,
          });
          return { b: context.b };
        };

        const testInput = {
          someObj: {
            a: testConstants.aPassedIn,
            b: testConstants.bPassedIn,
          },
        };
        const testOutput = { b: testConstants.bPassedIn };

        return {
          testConstants,
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

      it('sanitizeParams filtration functionality', async () => {
        const testedLifecycleStage = 'sanitizeParams';
        await HTPipeTest(
          HTPipe(
            sanitizersFiltrationTestData(testedLifecycleStage).left,
            sanitizersFiltrationTestData(testedLifecycleStage).right
          ),
          testedLifecycleStage,
          sanitizersFiltrationTestData(testedLifecycleStage).testInput,
          sanitizersFiltrationTestData(testedLifecycleStage).testOutput,
          true
        );
      });
      it('sanitizeQueryParams filtration functionality', async () => {
        const testedLifecycleStage = 'sanitizeQueryParams';
        await HTPipeTest(
          HTPipe(
            sanitizersFiltrationTestData(testedLifecycleStage).left,
            sanitizersFiltrationTestData(testedLifecycleStage).right
          ),
          testedLifecycleStage,
          sanitizersFiltrationTestData(testedLifecycleStage).testInput,
          sanitizersFiltrationTestData(testedLifecycleStage).testOutput,
          true
        );
      });
      it('sanitizeBody filtration functionality', async () => {
        const testedLifecycleStage = 'sanitizeBody';
        await HTPipeTest(
          HTPipe(
            sanitizersFiltrationTestData(testedLifecycleStage).left,
            sanitizersFiltrationTestData(testedLifecycleStage).right
          ),
          testedLifecycleStage,
          sanitizersFiltrationTestData(testedLifecycleStage).testInput,
          sanitizersFiltrationTestData(testedLifecycleStage).testOutput,
          true
        );
      });
      it('respond filtration functionality', async () => {
        const aPassedIn = 'some string';
        const bPassedIn = 'some other string';

        const left = {
          respond(context: { someObj: { a: string; b: string } }) {
            expect(context).toEqual({
              someObj: {
                a: aPassedIn,
                b: bPassedIn,
              },
            });
            return { unsafeResponse: context.someObj };
          },
        };

        const right = {
          respond(context: { a: string; b: string }) {
            expect(context).not.toHaveProperty('someObj');
            expect(context).toEqual({
              a: aPassedIn,
              b: bPassedIn,
            });
            return { unsafeResponse: { b: context.b } };
          },
        };

        const pipedRespond = HTPipe(left, right);

        await HTPipeTest(
          pipedRespond,
          'respond',
          {
            someObj: {
              a: aPassedIn,
              b: bPassedIn,
            },
          },
          {
            unsafeResponse: {
              b: bPassedIn,
            },
          },
          true
        );
      });
      it('sanitizeResponse filtration functionality', async () => {
        const testedLifecycleStage = 'sanitizeResponse';
        await HTPipeTest(
          HTPipe(
            sanitizersFiltrationTestData(testedLifecycleStage).left,
            sanitizersFiltrationTestData(testedLifecycleStage).right
          ),
          testedLifecycleStage,
          sanitizersFiltrationTestData(testedLifecycleStage).testInput,
          sanitizersFiltrationTestData(testedLifecycleStage).testOutput,
          true
        );
      });
    });
    describe('hipExpressHandlerFactory', () => {
      it('should pass when we have all correct lifecycles', () => {
        const handlingStrategy = {
          initPreContext() {
            return {};
          },
          sanitizeParams() {
            return {
              ting: 5,
            };
          },
          sanitizeBody() {
            return {
              ting: 5,
            };
          },
          preAuthorize(context: { params: { ting: number }; body: {} }) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: { asdf: { ting: number } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          doWork(context: {}) {
            return {};
          },
          respond(context: {}) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };
        hipExpressHandlerFactory(handlingStrategy);
      });
      it('should pass if respond lifecycle input params was provided by sanirizeParams lifecycle', () => {
        const handlingStrategy = {
          sanitizeParams() {
            return {
              ting: 5,
            };
          },
          preAuthorize(context: { params: { ting: number } }) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: { asdf: { ting: number } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          respond(context: { params: { ting: number } }) {
            return { unsafeResponse: context.params };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };
        hipExpressHandlerFactory(handlingStrategy);
      });
      it('should pass if finalAuthorize lifecycle input params was provided by attachData and sanitizeParams lifecycle', () => {
        const handlingStrategy = {
          sanitizeParams() {
            return {
              ting: 5,
            };
          },
          preAuthorize(context: { params: { ting: number } }) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: {
            params: { ting: number };
            asdf: { ting: number };
          }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { params: { ting: number }; ddd: string }) {
            return {};
          },
          respond(context: { params: { ting: number } }) {
            return { unsafeResponse: context.params };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };
        hipExpressHandlerFactory(handlingStrategy);
      });
      it('should give error when preauthorize lifecycle other param was not provided by sanitizeParams stage', () => {
        const handlingStrategy = {
          sanitizeParams() {
            return {
              ting: 5,
            };
          },
          preAuthorize(context: { params: { ting: number; other: string } }) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: { asdf: { ting: number } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          respond(context: {}) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        function hipExpressHandlerFactoryExpectError() {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        }
      });
      it('should give error when attachData lifecycle stage asdf param has type mismatch with preAuthorize stage output', () => {
        const handlingStrategy = {
          preAuthorize(context: {}) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: { asdf: { ting: string } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          respond(context: {}) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        function hipExpressHandlerFactoryExpectError() {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        }
      });
      it('should give error when finalAuthorize lifecycle testParam param whas not provided by previous stages way before', () => {
        const handlingStrategy = {
          sanitizeParams() {
            return {
              ting: 5,
            };
          },
          preAuthorize(context: { params: { ting: number } }) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: { asdf: { ting: number } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string; testParam: string }) {
            return {};
          },
          respond({}) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        function hipExpressHandlerFactoryExpectError() {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        }
      });
      it('should give error when respond lifecycle stage context.params has type mismatch with sanitizeParams stage output', () => {
        const handlingStrategy = {
          sanitizeParams() {
            return {
              ting: 5,
            };
          },
          preAuthorize(context: { params: { ting: number } }) {
            return { asdf: { ting: 4 } };
          },
          attachData(context: { asdf: { ting: number } }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          respond(context: { params: { ting: string } }) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        function hipExpressHandlerFactoryExpectError() {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        }
      });
      it('should give error when preAuthorize is missing', () => {
        const handlingStrategy = {
          attachData(context: {}) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: { ddd: string }) {
            return {};
          },
          respond(context: {}) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        let hipExpressHandlerFactoryError;

        try {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        } catch (err) {
          hipExpressHandlerFactoryError = err;
        }

        // tslint:disable-next-line:no-unused-expression
        expect(hipExpressHandlerFactoryError).toBeDefined();
      });
      it('should give error when finalAuthorize is missing', () => {
        const handlingStrategy = {
          preAuthorize(context: {}) {
            return {
              b: 5,
            };
          },
          attachData(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          respond(context: {}) {
            return { unsafeResponse: {} };
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        let hipExpressHandlerFactoryError;

        try {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        } catch (err) {
          hipExpressHandlerFactoryError = err;
        }

        // tslint:disable-next-line:no-unused-expression
        expect(hipExpressHandlerFactoryError).toBeDefined();
      });
      it('should give error when respond is missing', () => {
        const handlingStrategy = {
          preAuthorize(context: {}) {
            return {
              b: 5,
            };
          },
          attachData(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: {}) {
            return true;
          },
          sanitizeResponse(unsafeResponse: {}) {
            return {};
          },
        };

        let hipExpressHandlerFactoryError;

        try {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        } catch (err) {
          hipExpressHandlerFactoryError = err;
        }

        // tslint:disable-next-line:no-unused-expression
        expect(hipExpressHandlerFactoryError).toBeDefined();
      });
      it('should give error when sanitizeResponse is missing', () => {
        const handlingStrategy = {
          preAuthorize(context: {}) {
            return {
              b: 5,
            };
          },
          attachData(context: { b: number }) {
            return { adOut: 4, ddd: 'hi' };
          },
          finalAuthorize(context: {}) {
            return true;
          },
          respond(context: {}) {
            return { unsafeResponse: {} };
          },
        };

        let hipExpressHandlerFactoryError;

        try {
          // @ts-expect-error
          hipExpressHandlerFactory(handlingStrategy);
        } catch (err) {
          hipExpressHandlerFactoryError = err;
        }

        // tslint:disable-next-line:no-unused-expression
        expect(hipExpressHandlerFactoryError).toBeDefined();
      });
    });
  });
});

// @fixme: MAKE TESTS OUT OF EVERYTHING BELOW!
// cover withDefault cases too
// for each stage cover:
// - happy path from previous stage normal
// - happy path from way before normal
// - happy path from previous stage with extra keys in object PROVIDED
// - happy path from way before normal with extra keys in object PROVIDED
// - sad path missing that particular key altogether
// - sad path provided by previous but type mismatch
// - sad path ONLY PARTIALLY provided by previous (e.g. provided params: {a: string}, requesting params: {a: string, b: number})
// - sad path provided by way before but type mismatch
// - sad path ONLY PARTIALLY provided way before (e.g. provided params: {a: string}, requesting params: {a: string, b: number})
