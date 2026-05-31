// M12 — thin shim over dm-sender. Callers import sendDM from here (same as
// before), but must now pass recipient_id (IGSID) instead of just handle.

export type { CopyKey } from './dm-copy';
export { resolveCopy } from './dm-copy';
export { COPY } from './dm-copy';
export { copyKeyForRejectReason } from './dm-copy-legacy';

import { sendDM as _sendDM } from './dm-sender';
import type { SendDMInput } from './dm-sender';
import type { SendResult } from './dm-sender';

export type { SendDMInput, SendResult } from './dm-sender';

export async function sendDM(input: SendDMInput): Promise<SendResult> {
  if (!input.recipient_id) {
    throw new Error(
      `dm-stub.ts → sendDM: missing recipient_id. ` +
      `Callers must pass IGSID/platform_user_id. handle="${input.handle ?? ''}" copy_key="${input.copy_key}"`,
    );
  }
  return _sendDM(input);
}