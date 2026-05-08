// Stand-in for M12 (DM Reply Sender) until that module ships. When M12 lands,
// swap the implementation; call sites stay identical.

type SendDMArgs = {
  handle: string;
  platform: 'instagram' | 'tiktok';
  copy_key:
    // M2 link-DM handler:
    | 'link_confirm'
    | 'code_no_match'
    | 'cap_reached'
    | 'bound_elsewhere'
    // M4a Meta DM ingest:
    | 'step1_ack'
    | 'stranger'
    | 'no_url';
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
