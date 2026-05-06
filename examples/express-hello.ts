/**
 * Express hello world endpoint using HipThrusTS
 *
 * Run: npx ts-node examples/express-hello.ts
 * Test: curl -X POST http://localhost:3000/greet/Alice?shout=true -H "Content-Type: application/json" -d '{"greeting":"Hello"}'
 */
import express from 'express';
import { defineHandler, hipExpressHandlerFactory } from '../src';
import { HipError } from '../src/core';

const app = express();
app.use(express.json());

const greetHandler = defineHandler({
  sanitizeParams: (params: any) => {
    console.log('  [sanitizeParams] raw params:', params);
    if (!params.name) throw new HipError(400, 'Name param is required');
    return { name: params.name as string };
  },

  sanitizeQueryParams: (query: any) => {
    console.log('  [sanitizeQueryParams] raw query:', query);
    return { shout: query.shout === 'true' };
  },

  sanitizeBody: (body: any) => {
    console.log('  [sanitizeBody] raw body:', body);
    return { greeting: (body.greeting as string) || 'Hi' };
  },

  preAuthorize: ({ params, queryParams, body }) => {
    console.log('  [preAuthorize] context:', { params, queryParams, body });
    // Pretend we check an API key here
    return { authorized: true };
  },

  attachData: async ({ params }) => {
    console.log('  [attachData] looking up user:', params.name);
    // Pretend DB lookup
    const user = { id: '1', displayName: params.name, joined: '2024-01-01' };
    return { user };
  },

  finalAuthorize: ({ user }) => {
    console.log('  [finalAuthorize] user found:', user.displayName);
    return true;
  },

  doWork: ({ user, body, queryParams }) => {
    console.log('  [doWork] building greeting');
    let message = `${body.greeting}, ${user.displayName}! You joined on ${user.joined}.`;
    if (queryParams.shout) message = message.toUpperCase();
    return { message };
  },

  respond: ({ message }) => {
    console.log('  [respond] sending response');
    return { unsafeResponse: { message, timestamp: new Date().toISOString() }, status: 200 };
  },

  sanitizeResponse: (response: any) => {
    console.log('  [sanitizeResponse] filtering response');
    return response;
  },
});

app.post('/greet/:name', hipExpressHandlerFactory(greetHandler as any));

app.listen(4000, () => {
  console.log('Express example running at http://localhost:4000');
  console.log('Try: curl -X POST http://localhost:4000/greet/Alice?shout=true -H "Content-Type: application/json" -d \'{"greeting":"Hello"}\'');
});
