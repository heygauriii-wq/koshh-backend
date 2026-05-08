import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyMetaSignature } from './verify-meta';
import type { Request } from 'express';

const SECRET = process.env.META_APP_SECRET!;

function signPayload(buf: Buffer): string {
  const h = crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
  return `sha256=${h}`;
}

function fakeReq(rawBody: Buffer | undefined, header: string | undefined): Request {
  return {
    rawBody,
    header: (name: string) =>
      name.toLowerCase() === 'x-hub-signature-256' ? header : undefined,
  } as unknown as Request;
}

describe('verifyMetaSignature', () => {
  const body = Buffer.from(JSON.stringify({ entry: [{ id: 'x' }] }));

  it('accepts a correctly signed payload', () => {
    const req = fakeReq(body, signPayload(body));
    expect(verifyMetaSignature(req)).toEqual({ ok: true });
  });

  it('rejects mismatched signature', () => {
    const req = fakeReq(body, 'sha256=' + 'a'.repeat(64));
    expect(verifyMetaSignature(req)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects missing header', () => {
    const req = fakeReq(body, undefined);
    expect(verifyMetaSignature(req)).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('rejects malformed header', () => {
    expect(verifyMetaSignature(fakeReq(body, 'md5=garbage'))).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
    expect(verifyMetaSignature(fakeReq(body, 'sha256=tooShort'))).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
  });

  it('rejects when raw body missing', () => {
    const req = fakeReq(undefined, signPayload(body));
    expect(verifyMetaSignature(req)).toEqual({ ok: false, reason: 'no_raw_body' });
  });

  it('rejects when payload mutated post-sign', () => {
    const sig = signPayload(body);
    const tampered = Buffer.concat([body, Buffer.from(' ')]);
    const req = fakeReq(tampered, sig);
    expect(verifyMetaSignature(req)).toEqual({ ok: false, reason: 'mismatch' });
  });
});
