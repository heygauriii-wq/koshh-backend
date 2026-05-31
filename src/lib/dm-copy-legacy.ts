// M5-era DM copy key resolution. Moved here when M12's dm-copy.ts replaced
// dm-stub.ts. M5's pipeline still calls copyKeyForRejectReason to translate
// M3 rejection reasons into user-facing copy keys.

import type { CopyKey } from './dm-copy';
import type { M3RejectReason } from './url-validation/types';

const REJECT_TO_COPY: Record<M3RejectReason, CopyKey> = {
  unsupported_platform: 'unsupported_url',
  unsupported_content: 'unsupported_url',
  malformed_url: 'malformed_url',
  long_form_youtube: 'long_form_youtube',
  metadata_unavailable: 'metadata_unavailable',
};

export function copyKeyForRejectReason(reason: M3RejectReason): CopyKey {
  return REJECT_TO_COPY[reason];
}
