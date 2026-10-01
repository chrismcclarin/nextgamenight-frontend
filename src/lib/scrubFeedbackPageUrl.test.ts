// Plan 87.8-05 Task 4 — FE half of the pageUrl credential scrub.
import { describe, it, expect } from 'vitest';
import {
  isTokenBearingPath,
  scrubFeedbackPageUrl,
  TOKEN_QUERY_ROUTES,
  TOKEN_ROUTE_PREFIXES,
} from './scrubFeedbackPageUrl';

describe('isTokenBearingPath (Phase 88.6 R-7 — the replay-init gate)', () => {
  it('is true for every path-token prefix in the exported list', () => {
    for (const prefix of TOKEN_ROUTE_PREFIXES) {
      expect(isTokenBearingPath(`${prefix}abc123`), prefix).toBe(true);
    }
  });

  it('is true for the query-token routes (the credential is in ?token=, the Meta href keeps it)', () => {
    for (const route of TOKEN_QUERY_ROUTES) {
      expect(isTokenBearingPath(route), route).toBe(true);
    }
    expect(TOKEN_QUERY_ROUTES).toContain('/invite/accept');
  });

  it('is a PREFIX match on the path, never a substring match', () => {
    expect(isTokenBearingPath('/')).toBe(false);
    expect(isTokenBearingPath('/dashboard')).toBe(false);
    expect(isTokenBearingPath('/groups/invite-history')).toBe(false);
    expect(isTokenBearingPath('/rsvpx')).toBe(false);
    expect(isTokenBearingPath('/invite/accepted-list')).toBe(false);
  });

  it('handles null/undefined defensively (no replay gating on an unknown path)', () => {
    expect(isTokenBearingPath(null)).toBe(false);
    expect(isTokenBearingPath(undefined)).toBe(false);
  });
});

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
