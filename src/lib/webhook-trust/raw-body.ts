import type { Request, Response } from 'express';
import express from 'express';

// Stashes the raw body bytes on req.rawBody before JSON parse runs.
// Required for HMAC verification — Meta computes the HMAC over the raw bytes,
// and a parse → stringify round-trip is not byte-stable.
//
// Apply this middleware ONLY to /webhooks/* routes. Applying it globally is
// fine but wastes a buffer allocation on every request.
export const captureRawBody = express.json({
  verify: (req: Request, _res: Response, buf: Buffer) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  },
});

// Type augmentation so route handlers can read req.rawBody without casts.
// Same pattern as M1's req.userId augmentation in require-auth.ts.
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}
