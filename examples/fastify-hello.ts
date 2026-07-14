// Run with: pnpm exec tsx examples/fastify-hello.ts
// Then:     curl -X POST localhost:3002/greet/world
// (In your own project, import from 'hipthrusts/...' instead of '../src/...'.)
import Fastify from 'fastify';
import { HipBadInputs, HipForbidden } from '../src/errors';
import { toFastifyHandler } from '../src/fastify';

const greet = toFastifyHandler({
  sanitizeInputs: (i: { params: { name?: string } }) => {
    if (!i.params.name) {
      throw new HipBadInputs('Name param is required');
    }
    return { name: i.params.name };
  },
  preAuthorize: (ctx: { inputs: { name: string } }) => {
    if (ctx.inputs.name === 'admin') {
      throw new HipForbidden('Nice try');
    }
    return true;
  },
  finalAuthorize: () => true,
  execute: (ctx: { inputs: { name: string } }) => ({
    message: `Hello, ${ctx.inputs.name}!`,
  }),
  redactResponse: (u: { message: string }) => ({ message: u.message }),
});

const app = Fastify();
app.post('/greet/:name', greet);

const PORT = 3002;
app.listen({ port: PORT }, (err, address) => {
  if (err) {
    throw err;
  }
  console.log(`fastify-hello listening on ${address}`);
});
