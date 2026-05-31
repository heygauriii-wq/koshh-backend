// M12 dm-sender — D-009 structured stdout logging

import type { SendDMInput, SendResult } from './types';

export function logAttempt(input: SendDMInput): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: 'outbound_dm_attempt',
    user_id: input.user_id ?? null,
    handle: input.handle ?? null,
    platform: input.platform,
    recipient_id: input.recipient_id,
    copy_key: input.copy_key,
    success: null,
    error_code: 'pending',
  }));
}

export function logResult(input: SendDMInput, outcome: SendResult): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: 'outbound_dm_result',
    user_id: input.user_id ?? null,
    handle: input.handle ?? null,
    platform: input.platform,
    recipient_id: input.recipient_id,
    copy_key: input.copy_key,
    success: outcome.success,
    error_code: outcome.success ? null : outcome.error_code,
    error_message: outcome.success ? null : outcome.error_message,
    meta_message_id: outcome.success ? outcome.meta_message_id : null,
    attempts_used: outcome.attempts_used,
  }));
}