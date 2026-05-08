import crypto from 'node:crypto';
import type { Request } from 'express';

// Fail loud at boot, not at first webhook. M4a depends on this secret for
// every inbound request; a missing secret is a deploy bug, not a runtime bug.
const META_APP_SECRET = process.env.META_APP_SECRET;
if (!META_APP_SECRET) {
  throw new Error('META_APP_SECRET is not set');
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'missing_signature' | 'malformed_signature' | 'mismatch' | 'no_raw_body';
    };

export function verifyMetaSignature(req: Request): VerifyResult {
  const header = req.header('x-hub-signature-256');
  if (!header) return { ok: false, reason: 'missing_signature' };

  // Header format: 'sha256=<64 hex chars>'
  const [scheme, theirHex] = header.split('=', 2);
  if (scheme !== 'sha256' || !theirHex || !/^[a-f0-9]{64}$/i.test(theirHex)) {
    return { ok: false, reason: 'malformed_signature' };
  }

  if (!req.rawBody) return { ok: false, reason: 'no_raw_body' };

  const ourHex = crypto
    .createHmac('sha256', META_APP_SECRET!)
    .update(req.rawBody)
    .digest('hex');

  // timingSafeEqual requires equal-length buffers; we already verified
  // 64 hex chars on theirHex, and SHA-256 is always 64 hex chars on ours.
  const ours = Buffer.from(ourHex, 'hex');
  const theirs = Buffer.from(theirHex, 'hex');
  if (!crypto.timingSafeEqual(ours, theirs)) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true };
}
