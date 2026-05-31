import { describe, it, vi, beforeEach, expect } from 'vitest';

vi.mock('./meta', () => ({
  sendViaMeta: vi.fn(),
}));

import { sendDM } from './index';
import * as meta from './meta';

describe('sendDM orchestration', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('happy path: pre-call log + meta send + post-call log', async () => {
    vi.mocked(meta.sendViaMeta).mockResolvedValue({ success: true, meta_message_id: 'mid.$x', attempts_used: 1 });
    const r = await sendDM({
      recipient_id: 'IGSID',
      platform: 'instagram',
      copy_key: 'step1_ack',
      handle: 'tester',
      user_id: 'usr-1',
    });
    expect(r).toEqual({ success: true, meta_message_id: 'mid.$x', attempts_used: 1 });
    expect(meta.sendViaMeta).toHaveBeenCalledWith('IGSID', 'Got it! Saving... ✓', { maxAttempts: 2 });
    // Two log lines: attempt + result
    expect(stdoutSpy).toHaveBeenCalledTimes(2);
    const attempt = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    const result = JSON.parse(stdoutSpy.mock.calls[1][0] as string);
    expect(attempt.event).toBe('outbound_dm_attempt');
    expect(attempt.success).toBeNull();
    expect(attempt.error_code).toBe('pending');
    expect(result.event).toBe('outbound_dm_result');
    expect(result.success).toBe(true);
    expect(result.meta_message_id).toBe('mid.$x');
    expect(result.attempts_used).toBe(1);
  });

  it('failure path: post-call log carries typed error + attempts_used', async () => {
    vi.mocked(meta.sendViaMeta).mockResolvedValue({
      success: false,
      error_code: 'oauth_exception',
      error_message: 'Bad signature',
      attempts_used: 1,
    });
    await sendDM({
      recipient_id: 'IGSID',
      platform: 'instagram',
      copy_key: 'step1_ack',
    });
    const result = JSON.parse(stdoutSpy.mock.calls[1][0] as string);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe('oauth_exception');
    expect(result.attempts_used).toBe(1);
  });

  it('passes retryBudget through to sendViaMeta', async () => {
    vi.mocked(meta.sendViaMeta).mockResolvedValue({ success: true, meta_message_id: 'mid.$x', attempts_used: 1 });
    await sendDM({
      recipient_id: 'IGSID',
      platform: 'instagram',
      copy_key: 'update_confirm',
      retryBudget: 3,
    });
    expect(meta.sendViaMeta).toHaveBeenCalledWith(
      'IGSID',
      expect.any(String),
      { maxAttempts: 3 },
    );
  });

  it('defaults retryBudget to 2 when caller omits', async () => {
    vi.mocked(meta.sendViaMeta).mockResolvedValue({ success: true, meta_message_id: 'mid.$x', attempts_used: 1 });
    await sendDM({
      recipient_id: 'IGSID',
      platform: 'instagram',
      copy_key: 'step1_ack',
    });
    expect(meta.sendViaMeta).toHaveBeenCalledWith(
      'IGSID',
      expect.any(String),
      { maxAttempts: 2 },
    );
  });

  it('logs attempts_used > 1 when retry happened', async () => {
    vi.mocked(meta.sendViaMeta).mockResolvedValue({
      success: true,
      meta_message_id: 'mid.$retried',
      attempts_used: 2,
    });
    await sendDM({
      recipient_id: 'IGSID',
      platform: 'instagram',
      copy_key: 'step1_ack',
    });
    const result = JSON.parse(stdoutSpy.mock.calls[1][0] as string);
    expect(result.attempts_used).toBe(2);
    expect(result.success).toBe(true);
  });

  it('TikTok platform returns deferred error without calling meta', async () => {
    const r = await sendDM({
      recipient_id: 'TT_USER_ID',
      platform: 'tiktok',
      copy_key: 'step1_ack',
    });
    expect(meta.sendViaMeta).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.attempts_used).toBe(0);
  });

  it('null recipient_id returns oauth_exception without calling meta', async () => {
    const r = await sendDM({
      recipient_id: null,
      platform: 'instagram',
      copy_key: 'stranger',
    });
    expect(meta.sendViaMeta).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error_code).toBe('oauth_exception');
  });

  it('pre-call log fires BEFORE the await of meta send', async () => {
    // Use a never-resolving promise to verify the pre-call log already happened
    let preCallLogged = false;
    vi.mocked(meta.sendViaMeta).mockImplementation(() => new Promise(() => {
      preCallLogged = stdoutSpy.mock.calls.length === 1;
      throw new Error('should-have-logged');
    }));
    try {
      await sendDM({ recipient_id: 'IGSID', platform: 'instagram', copy_key: 'step1_ack' });
    } catch { /* expected */ }
    expect(preCallLogged).toBe(true);
  });
});