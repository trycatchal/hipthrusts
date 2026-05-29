// Reference shape for a Next.js App Router route handler. In a real app this
// would live at e.g. `app/api/greet/[name]/route.ts` and you'd export the
// verb handlers directly. It is not meant to be run standalone with tsx.
import { NextRequest } from 'next/server';
import { HipBadInputs } from '../src/errors';
import { toNextHandler } from '../src/next';

const greet = toNextHandler(
  {
    // `gatherContext` (below) merged its result into the raw envelope, so
    // extractAmbient can read e.g. an authenticated principal here.
    extractAmbient: (raw: { principal?: string }) => ({
      principal: raw.principal,
    }),
    sanitizeInputs: (i: { params: { name?: string } }) => {
      if (!i.params.name) {
        throw new HipBadInputs('Name param is required');
      }
      return { name: i.params.name };
    },
    preAuthorize: () => true,
    finalAuthorize: () => true,
    execute: (ctx: {
      inputs: { name: string };
      ambient: { principal?: string };
    }) => ({
      message: `Hello, ${ctx.inputs.name}!`,
      requestedBy: ctx.ambient.principal ?? 'anonymous',
    }),
    redactResponse: (u: { message: string; requestedBy: string }) => u,
  },
  {
    // e.g. read the signed-in user from Clerk/your auth before the lifecycle.
    gatherContext: async (req: NextRequest) => ({
      principal: 'user-from-auth',
    }),
  }
);

export const POST = greet;
