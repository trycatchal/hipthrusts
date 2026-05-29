// Run with: pnpm exec tsx examples/hono-hello.ts
// Then:     curl -X POST localhost:3001/greet/world
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { HipBadInputs } from '../src/errors';
import { toHonoHandler } from '../src/hono';

const greet = toHonoHandler({
  sanitizeInputs: (i: { params: { name?: string } }) => {
    if (!i.params.name) {
      throw new HipBadInputs('Name param is required');
    }
    return { name: i.params.name };
  },
  preAuthorize: () => true,
  finalAuthorize: () => true,
  execute: (ctx: { inputs: { name: string } }) => ({
    message: `Hello, ${ctx.inputs.name}!`,
  }),
  redactResponse: (u: { message: string }) => ({ message: u.message }),
});

const app = new Hono();
app.post('/greet/:name', c => greet(c));

const PORT = 3001;
serve({ fetch: app.fetch, port: PORT }, () => {
  // tslint:disable-next-line:no-console
  console.log(`hono-hello listening on http://localhost:${PORT}`);
});
