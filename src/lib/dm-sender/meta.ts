// M12 dm-sender — Meta IG Send API adapter

import type { BareResult, ErrorCode, SendResult } from './types';

const META_API_HOST = 'https://graph.instagram.com';
const API_VERSION = 'v23.0';
const TIMEOUT_MS = 5000;

const TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.META_IG_BUSINESS_ACCOUNT_ID;

if (!TOKEN) {
  throw new Error('META_PAGE_ACCESS_TOKEN not set');
}
if (!IG_ACCOUNT_ID) {
  throw new Error('META_IG_BUSINESS_ACCOUNT_ID not set');
}

async function sendViaMetaOnce(
  recipient_id: string,
  text: string,
): Promise<BareResult> {
  const url = `${META_API_HOST}/${API_VERSION}/${IG_ACCOUNT_ID}/messages`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Wrap fetch in Promise.resolve to ensure rejections (e.g. from test mocks)
    // are properly caught even in edge cases
    const res = await Promise.resolve(fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipient_id },
        message: { text },
      }),
      signal: controller.signal,
    }));

    clearTimeout(timeout);
    const body: Record<string, unknown> = await res.json().catch(() => ({}));

    if (res.ok && (body as { message_id?: string }).message_id) {
      return { success: true, meta_message_id: (body as { message_id: string }).message_id };
    }

    const error = (body as { error?: unknown }).error as Record<string, unknown> | undefined;
    const error_code = classifyError(res.status, error);
    return {
      success: false,
      error_code,
      error_message: typeof error?.message === 'string' ? error.message : `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') {
      return { success: false, error_code: 'timeout', error_message: `Timeout after ${TIMEOUT_MS}ms` };
    }
    return { success: false, error_code: 'network_error', error_message: e.message ?? String(err) };
  }
}

export async function sendViaMeta(
  recipient_id: string,
  text: string,
  opts: { maxAttempts: number } = { maxAttempts: 2 },
): Promise<SendResult> {
  let last: BareResult | null = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    last = await sendViaMetaOnce(recipient_id, text);
    if (last.success) return { ...last, attempts_used: attempt };
    if (!isTransient(last.error_code)) return { ...last, attempts_used: attempt };
    if (attempt < opts.maxAttempts) {
      await sleep(150 * attempt);
    }
  }
  return { ...last!, attempts_used: opts.maxAttempts };
}

function isTransient(code: ErrorCode): boolean {
  return (
    code === 'rate_limited' ||
    code === 'timeout' ||
    code === 'network_error' ||
    code === 'unknown'
  );
}

function classifyError(status: number, error: Record<string, unknown> | undefined): ErrorCode {
  if (status === 429 || error?.code === 4) return 'rate_limited';
  if (error?.type === 'OAuthException' || error?.code === 190 || error?.code === 200) return 'oauth_exception';
  if (error?.code === 10 && /outside the 24/i.test(String(error?.message ?? ''))) return 'outside_24h';
  if (error?.code === 551 || /blocked/i.test(String(error?.message ?? ''))) return 'recipient_blocked';
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
