// Stand-in for M12 (DM Reply Sender) until that module ships. When M12 lands,
// swap the implementation; call sites stay identical.

import type { M3RejectReason } from './url-validation/types';

export type CopyKey =
  // M2 link-DM handler:
  | 'link_confirm'
  | 'code_no_match'
  | 'cap_reached'
  | 'bound_elsewhere'
  // M4a Meta DM ingest:
  | 'step1_ack'
  | 'stranger'
  | 'no_url'
  | 'unsupported_attachment'
  // M5 additions:
  | 'update_confirm'
  | 'content_unavailable'
  // M3 reject reasons (routed from M5's orchestrator):
  | 'unsupported_url'
  | 'malformed_url'
  | 'long_form_youtube'
  | 'metadata_unavailable';

type SendDMArgs = {
  handle: string;
  platform: 'instagram' | 'tiktok';
  copy_key: CopyKey;
  args?: Record<string, string>;
};

export async function sendDM(args: SendDMArgs): Promise<void> {
  // D-009: structured stdout is the MVP audit channel
  console.log(JSON.stringify({
    kind: 'outbound_dm_stub',
    ts: new Date().toISOString(),
    ...args,
  }));
}

// M5 orchestrator boundary: M3 returns a reason; the user-facing copy lives
// in src/lib/url-validation/reject-copy.ts; M12 will look up by CopyKey.
// `unsupported_content` (carousel) and `unsupported_platform` both surface as
// `unsupported_url` here — same shape, same advice, M3 owns the explanation.
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
