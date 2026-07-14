// Smoke test: every subpath must be importable from the built package (ESM),
// and error classes must share a single HipError copy across entry points.
import assert from 'node:assert';

const expectations = {
  hipthrusts: 'HTPipe',
  'hipthrusts/core': 'executeHipthrustable',
  'hipthrusts/errors': 'isHipError',
  'hipthrusts/http-adapter': 'composeHttpHipthrustable',
  'hipthrusts/lifecycle-functions': 'Execute',
  'hipthrusts/types': null, // type-only module; importing it must not throw
  'hipthrusts/user': 'assigneeCheckersOnIdKey',
  'hipthrusts/express': 'toExpressHandler',
  'hipthrusts/fastify': 'toFastifyHandler',
  'hipthrusts/hono': 'toHonoHandler',
  'hipthrusts/next': 'toNextHandler',
  'hipthrusts/mongoose': 'htMongooseFactory',
  'hipthrusts/zod': 'htZodFactory',
  'hipthrusts/trpc': 'toTrpcProcedure',
};

for (const [subpath, exportName] of Object.entries(expectations)) {
  const mod = await import(subpath);
  if (exportName) {
    assert.ok(
      typeof mod[exportName] !== 'undefined',
      `${subpath} is missing expected export ${exportName}`
    );
  }
}

const root = await import('hipthrusts');
const errors = await import('hipthrusts/errors');
assert.ok(
  errors.isHipError(new root.HipNotFound('x')),
  'HipError class must be shared between root and /errors entries (ESM)'
);

console.log('smoke (mjs): ok');
