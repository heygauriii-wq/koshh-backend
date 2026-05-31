import { describe, it, expect } from 'vitest';
import { resolveCopy } from '../lib/dm-copy';

describe('dm-copy resolveCopy', () => {
  it('resolves static keys', () => {
    expect(resolveCopy('step1_ack')).toBe('Got it! Saving... ✓');
    expect(resolveCopy('link_confirm')).toContain("You're linked");
    expect(resolveCopy('code_no_match')).toContain("didn't match");
    expect(resolveCopy('cap_reached')).toContain('5-handle limit');
    expect(resolveCopy('stranger')).toContain("isn't connected");
    expect(resolveCopy('no_url')).toContain('only accepts links');
    expect(resolveCopy('content_unavailable')).toContain('deleted');
    expect(resolveCopy('unsupported_url')).toContain("doesn't look right");
    expect(resolveCopy('malformed_url')).toContain("doesn't look right");
    expect(resolveCopy('long_form_youtube')).toContain('YouTube Shorts only');
    expect(resolveCopy('metadata_unavailable')).toContain("couldn't read");
  });

  it('bound_elsewhere injects masked email', () => {
    const out = resolveCopy('bound_elsewhere', { masked_email: 'k***@***.com' });
    expect(out).toContain('k***@***.com');
    expect(out).toContain('already linked to a Koshh account');
  });

  it('update_confirm with no title gracefully degrades', () => {
    const noTitle = resolveCopy('update_confirm', {});
    expect(noTitle).toBe('Updated ✓ — we refreshed your annotation and tags.');
    const withTitle = resolveCopy('update_confirm', { title: 'Easy 20-min dinner' });
    expect(withTitle).toContain('Easy 20-min dinner');
    expect(withTitle).toContain('Updated ✓');
  });

  it('every CopyKey has an entry', () => {
    const keys = [
      'step1_ack', 'link_confirm', 'code_no_match', 'cap_reached',
      'bound_elsewhere', 'stranger', 'no_url', 'update_confirm',
      'content_unavailable', 'unsupported_url', 'malformed_url',
      'long_form_youtube', 'metadata_unavailable',
    ] as const;
    for (const k of keys) {
      // Cast through `any` only because some entries need args; this is an existence check
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = (resolveCopy as any)(k, k === 'bound_elsewhere' ? { masked_email: 'x' } : k === 'update_confirm' ? { title: 't' } : undefined);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(5);
    }
  });
});
