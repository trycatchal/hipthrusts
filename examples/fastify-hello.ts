/**
 * Fastify hello world endpoint using HipThrusTS
 *
 * Run: npx ts-node examples/fastify-hello.ts
 * Test: curl -X POST http://localhost:3002/greet/Charlie -H "Content-Type: application/json" -d '{"greeting":"Yo"}'
 */
import Fastify from 'fastify';
import { defineHandler } from '../src/adapter';
import { hipFastifyHandlerFactory } from '../src/fastify';
import { HipError } from '../src/core';

const app = Fastify();

const greetHandler = defineHandler({
  sanitizeParams: (params: any) => {
    console.log('  [sanitizeParams]', params);
    if (!params.name) throw new HipError(400, 'Name required');
    return { name: params.name as string };
  },

  sanitizeBody: (body: any) => {
    console.log('  [sanitizeBody]', body);
    return { greeting: (body.greeting as string) || 'Hi' };
  },

  preAuthorize: ({ params }) => {
    console.log('  [preAuthorize] checking access for:', params.name);
    if (params.name === 'admin') throw new HipError(403, 'Nice try');
    return true;
  },

  attachData: async ({ params }) => {
    console.log('  [attachData] fetching profile');
    return { favoriteColor: params.name === 'Charlie' ? 'blue' : 'green' };
  },

  finalAuthorize: () => true,

  doWork: ({ params, body, favoriteColor }) => {
    console.log('  [doWork] composing response');
    return {
      message: `${body.greeting}, ${params.name}! Your favorite color is ${favoriteColor}.`,
    };
  },

  respond: ({ message }) => ({
    unsafeResponse: { message, framework: 'fastify' },
    status: 200,
  }),

  sanitizeResponse: (r: any) => r,
});

app.post('/greet/:name', hipFastifyHandlerFactory(greetHandler as any));

app.listen({ port: 3002 }).then(() => {
  console.log('Fastify example running at http://localhost:3002');
  console.log('Try: curl -X POST http://localhost:3002/greet/Charlie -H "Content-Type: application/json" -d \'{"greeting":"Yo"}\'');
  console.log('Try error: curl -X POST http://localhost:3002/greet/admin -H "Content-Type: application/json" -d \'{}\'');
});
