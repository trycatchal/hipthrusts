/**
 * Next.js App Router hello world endpoint using HipThrusTS
 *
 * This file shows what a Next.js route.ts would look like.
 * (Can't run standalone — needs Next.js server. This is for reference.)
 *
 * File would be at: app/api/greet/[name]/route.ts
 */
import { defineHandler } from '../src/adapter';
import { hipNextHandlerFactory } from '../src/next';
import { HipError } from '../src/core';

const greetHandler = defineHandler({
  initPreContext: (unsafe: any) => {
    console.log('  [initPreContext] raw request URL:', unsafe.req?.url);
    return { requestedAt: new Date().toISOString() };
  },

  sanitizeParams: (params: any) => {
    console.log('  [sanitizeParams] raw params:', params);
    if (!params.name) throw new HipError(400, 'Name param is required');
    return { name: params.name as string };
  },

  sanitizeBody: (body: any) => {
    console.log('  [sanitizeBody] raw body:', body);
    return { greeting: (body.greeting as string) || 'Hi' };
  },

  preAuthorize: ({ params, body, preContext }) => {
    console.log('  [preAuthorize] name:', params.name, 'greeting:', body.greeting);
    // In real app: check Clerk auth here
    return { clerkUserId: 'user-123' };
  },

  attachData: async ({ clerkUserId, params }) => {
    console.log('  [attachData] fetching user for:', clerkUserId);
    // In real app: Payload CMS lookup
    const user = { id: clerkUserId, displayName: params.name };
    return { user };
  },

  finalAuthorize: ({ user }) => {
    console.log('  [finalAuthorize] user:', user.displayName);
    return true;
  },

  doWork: ({ user, body }) => {
    console.log('  [doWork] building greeting');
    const message = `${body.greeting}, ${user.displayName}!`;
    return { message };
  },

  respond: ({ message, preContext }) => {
    console.log('  [respond] done');
    return {
      unsafeResponse: { message, requestedAt: preContext.requestedAt },
      status: 200,
    };
  },

  sanitizeResponse: (response: any) => response,
});

// This is what you'd export in route.ts:
export const POST = hipNextHandlerFactory(greetHandler as any, {
  gatherContext: async (req) => {
    // In real app: const { userId } = await auth();
    return { clerkUserId: 'user-from-clerk' };
  },
});
