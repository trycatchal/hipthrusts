// Run with: pnpm exec tsx examples/express-hello.ts
// Then:     curl -X POST localhost:4000/greet/world
// (In your own project, import from 'hipthrusts/...' instead of '../src/...'.)
import express, { NextFunction, Request, Response } from 'express';
import {
  HipBadInputs,
  hipErrorToBody,
  hipErrorToStatus,
  isHipError,
} from '../src/errors';
import { defineExpressHandler, toExpressHandler } from '../src/express';

const greet = defineExpressHandler({
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
  responseMeta: { status: 200 },
});

const app = express();
app.use(express.json());
// By default the adapter responds to errors directly
// (status + { error, issues?, detail? }) — no error middleware needed.
// This example opts into `delegateErrors` to show the middleware route:
app.post('/greet/:name', toExpressHandler(greet, { delegateErrors: true }));

// With delegateErrors, every error reaches next(); translate it yourself:
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (isHipError(err)) {
    res.status(hipErrorToStatus(err)).json(hipErrorToBody(err));
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`express-hello listening on http://localhost:${PORT}`);
});
