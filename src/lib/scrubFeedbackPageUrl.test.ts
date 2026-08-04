// Plan 87.8-05 Task 4 — FE half of the pageUrl credential scrub.
import { describe, it, expect } from 'vitest';
import { scrubFeedbackPageUrl, TOKEN_ROUTE_PREFIXES } from './scrubFeedbackPageUrl';

describe('scrubFeedbackPageUrl (Plan 87.8-05 Task 4)', () => {
  it('replaces the token segment of every token-bearing route with the literal placeholder', () => {
    expect(scrubFeedbackPageUrl('/availability-form/eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe(
      '/availability-form/[token]',
    );
    expect(scrubFeedbackPageUrl('/rsvp/3f9a1c2b4d5e6f70')).toBe('/rsvp/[token]');
    expect(scrubFeedbackPageUrl('/invite/group/abcdef123456')).toBe('/invite/group/[token]');
    expect(scrubFeedbackPageUrl('/invite/game/abcdef123456')).toBe('/invite/game/[token]');
    expect(scrubFeedbackPageUrl('/restore/group/deadbeefcafe')).toBe('/restore/group/[token]');
  });

  it('covers every prefix in the exported list (no route can silently drop out)', () => {
    for (const prefix of TOKEN_ROUTE_PREFIXES) {
      expect(scrubFeedbackPageUrl(`${prefix}some-live-credential`)).toBe(`${prefix}[token]`);
    }
  });

  it('never truncates the token partially — the whole remainder becomes the placeholder', () => {
    expect(scrubFeedbackPageUrl('/availability-form/tok/extra/segments')).toBe(
      '/availability-form/[token]',
    );
  });

  it('leaves non-token routes unchanged', () => {
    expect(scrubFeedbackPageUrl('/groupHomePage')).toBe('/groupHomePage');
    expect(scrubFeedbackPageUrl('/friends')).toBe('/friends');
    expect(scrubFeedbackPageUrl('/')).toBe('/');
  });

  it('handles null/undefined pathname defensively', () => {
    expect(scrubFeedbackPageUrl(null)).toBe('/');
    expect(scrubFeedbackPageUrl(undefined)).toBe('/');
  });
});
