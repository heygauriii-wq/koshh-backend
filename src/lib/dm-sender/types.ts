// M12 dm-sender — typed result envelopes

import type { CopyKey } from '../dm-copy';

export type SendDMInput = {
  recipient_id: string | null;
  platform: 'instagram' | 'tiktok';
  copy_key: CopyKey;
  args?: Record<string, unknown>;
  user_id?: string | null;
  handle?: string;
  retryBudget?: number;
};

export type SendResult =
  | { success: true; meta_message_id: string; attempts_used: number }
  | { success: false; error_code: ErrorCode; error_message: string; attempts_used: number };

export type ErrorCode =
  | 'oauth_exception'
  | 'rate_limited'
  | 'outside_24h'
  | 'recipient_blocked'
  | 'timeout'
  | 'network_error'
  | 'unknown';

// Bare result without attempts_used (used internally by sendViaMetaOnce)
export type BareResult =
  | { success: true; meta_message_id: string }
  | { success: false; error_code: ErrorCode; error_message: string };