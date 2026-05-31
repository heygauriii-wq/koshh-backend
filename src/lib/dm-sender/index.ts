// M12 dm-sender — sendDM orchestration entry point

import { resolveCopy } from '../dm-copy';
import { logAttempt, logResult } from './audit-log';
import { sendViaMeta } from './meta';
import type { SendDMInput, SendResult } from './types';

export async function sendDM(input: SendDMInput): Promise<SendResult> {
  // Pre-call log — synchronous, before any await (D-009 invariant)
  logAttempt(input);

  // Copy resolution
  const text = resolveCopy(input.copy_key, input.args as Parameters<typeof resolveCopy>[1]);

  // Retry budget: caller-provided, defaults to 2
  const maxAttempts = input.retryBudget ?? 2;

  // Platform dispatch
  let result: SendResult;
  if (input.platform === 'instagram') {
    if (!input.recipient_id) {
      // No IGSID — can't send. Log the attempt and return an oauth_exception
      // (the most fitting "permanent failure, don't retry" code for "we literally
      // don't have a recipient to send to").
      result = {
        success: false,
        error_code: 'oauth_exception',
        error_message: 'No recipient_id — platform_user_id not yet populated for this sender',
        attempts_used: 0,
      };
    } else {
      result = await sendViaMeta(input.recipient_id, text, { maxAttempts });
    }
  } else {
    // TikTok and YouTube Shorts deferred to M4b / M13
    result = {
      success: false,
      error_code: 'unknown',
      error_message: `Platform ${input.platform} not supported at MVP (deferred)`,
      attempts_used: 0,
    };
  }

  // Post-call log
  logResult(input, result);
  return result;
}

export type { SendDMInput, SendResult, ErrorCode } from './types';