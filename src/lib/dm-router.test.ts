import { describe, it, expect } from 'vitest';
import { routeDM } from './dm-router';
import { parseDmBody } from './dm-parser';

describe('routeDM', () => {
  it('routes to "save" when URLs are present', () => {
    const body = 'https://insta.com/reel/x';
    expect(routeDM(parseDmBody(body), body)).toBe('save');
  });

  it('routes to "link" on bare link code', () => {
    const body = 'koshh_a3f8c2b1';
    expect(routeDM(parseDmBody(body), body)).toBe('link');
  });

  it('routes to "save" when both link code and URL present (URL precedence)', () => {
    const body = 'koshh_a3f8c2b1 https://insta.com/reel/x';
    expect(routeDM(parseDmBody(body), body)).toBe('save');
  });

  it('routes to "no_url" on text-only', () => {
    const body = 'hi how are you';
    expect(routeDM(parseDmBody(body), body)).toBe('no_url');
  });

  it('is case-insensitive on link code', () => {
    const body = 'KOSHH_A3F8C2B1';
    expect(routeDM(parseDmBody(body), body)).toBe('link');
  });

  it('tolerates surrounding whitespace on link code', () => {
    const body = '   koshh_a3f8c2b1\n';
    expect(routeDM(parseDmBody(body), body)).toBe('link');
  });

  it('rejects malformed link codes', () => {
    expect(routeDM(parseDmBody('koshh_xyz'), 'koshh_xyz')).toBe('no_url');
    expect(routeDM(parseDmBody('koshh_'), 'koshh_')).toBe('no_url');
  });
});
