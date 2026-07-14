// Run with: pnpm exec tsx examples/express-hello.ts
// Then:     curl -X POST localhost:4000/greet/world
// (In your own project, import from 'hipthrusts/...' instead of '../src/...'.)
import express, { NextFunction, Request, Response } from 'express';
import { HipBadInputs } from '../src/errors';
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
app.post('/greet/:name', toExpressHandler(greet));

// Express error middleware: hipthrusts hands Boom errors to next().
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err && err.isBoom) {
    res.status(err.output.statusCode).json(err.output.payload);
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`express-hello listening on http://localhost:${PORT}`);
});
