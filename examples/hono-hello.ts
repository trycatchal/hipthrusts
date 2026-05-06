/**
 * Hono hello world endpoint using HipThrusTS
 *
 * Run: npx ts-node examples/hono-hello.ts
 * Test: curl -X POST http://localhost:3001/greet/Bob -H "Content-Type: application/json" -d '{"greeting":"Hey"}'
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { defineHandler } from '../src/adapter';
import { hipHonoHandlerFactory } from '../src/hono';
import { HipError } from '../src/core';

const app = new Hono();

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

  preAuthorize: ({ params, body }) => {
    console.log('  [preAuthorize] name:', params.name);
    return { role: 'user' };
  },

  attachData: async ({ params }) => {
    console.log('  [attachData] loading data for:', params.name);
    return { emoji: params.name === 'Bob' ? '👋' : '🎉' };
  },

  finalAuthorize: () => true,

  doWork: ({ params, body, emoji }) => {
    console.log('  [doWork] building message');
    return { message: `${body.greeting} ${params.name}! ${emoji}` };
  },

  respond: ({ message }) => ({
    unsafeResponse: { message },
    status: 200,
  }),

  sanitizeResponse: (r: any) => r,
});

app.post('/greet/:name', hipHonoHandlerFactory(greetHandler as any));

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('Hono example running at http://localhost:3001');
  console.log('Try: curl -X POST http://localhost:3001/greet/Bob -H "Content-Type: application/json" -d \'{"greeting":"Hey"}\'');
});
