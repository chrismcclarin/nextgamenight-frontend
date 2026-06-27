import { describe, it, expect } from 'vitest';
// The scrub module lives at the repo root (imported by the three sentry.*.config.js
// runtime files). This test lives under src/ (A3) so the vitest `include` collects
// it; it reaches the root module via a relative path.
import {
  scrubString,
  scrubUrl,
  scrubEvent,
  scrubRecordingEvent,
} from '../../sentry.scrub.js';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('scrubString / scrubUrl', () => {
  it('scrubString redacts emails and JWT-looking tokens', () => {
    expect(scrubString('mail me at alice@example.com')).toContain('[REDACTED]');
    expect(scrubString('mail me at alice@example.com')).not.toContain('alice@example.com');
    expect(scrubString(`token=${JWT}`)).not.toContain(JWT);
  });

  it('scrubUrl strips the query string and known token path segments', () => {
    const u1 = scrubUrl(`https://x/rsvp?magic_token=${JWT}`);
    expect(u1).not.toContain(JWT);
    expect(u1).toContain('[REDACTED]');

    const u2 = scrubUrl(`https://x/invite-preview/info/${JWT}`);
    expect(u2).not.toContain(JWT);
    expect(u2).toContain('[REDACTED]');
  });
});

describe('scrubEvent', () => {
  it('(a) redacts a token-bearing fetch breadcrumb URL and a ?magic_token= request URL', () => {
    const event = {
      message: `nav to https://x/invite/${JWT}`,
      breadcrumbs: [
        {
          category: 'fetch',
          message: `GET https://x/invite-preview/info/${JWT}`,
          data: { url: `https://x/invite-preview/info/${JWT}` },
        },
      ],
      request: {
        url: `https://x/rsvp?magic_token=${JWT}`,
        query_string: `magic_token=${JWT}`,
      },
    };
    const out = scrubEvent(event);

    expect(out.message).not.toContain(JWT);
    expect(out.breadcrumbs[0].data.url).not.toContain(JWT);
    expect(out.breadcrumbs[0].data.url).toContain('[REDACTED]');
    expect(out.breadcrumbs[0].message).not.toContain(JWT);
    expect(out.request.url).not.toContain(JWT);
    expect(JSON.stringify(out.request)).toContain('[REDACTED]');
  });

  it('(b) GAP2 — redacts an event.extra PII value regardless of key name', () => {
    const event = { extra: { userEmail: 'x@y.com' } };
    const out = scrubEvent(event);
    expect(out.extra.userEmail).toBe('[REDACTED]');
    expect(JSON.stringify(out.extra)).not.toContain('x@y.com');
  });

  it('(c) GAP2 — redacts a JWT embedded in an exception value, keeping surrounding text', () => {
    const event = { exception: { values: [{ value: `failed with ${JWT}` }] } };
    const out = scrubEvent(event);
    expect(out.exception.values[0].value).not.toContain(JWT);
    expect(out.exception.values[0].value).toContain('[REDACTED]');
    expect(out.exception.values[0].value).toContain('failed with');
  });

  it('scrubs nested event.contexts PII by pattern', () => {
    const event = { contexts: { auth: { authorization: `Bearer ${JWT}` } } };
    const out = scrubEvent(event);
    expect(JSON.stringify(out.contexts)).not.toContain(JWT);
    expect(JSON.stringify(out.contexts)).toContain('[REDACTED]');
  });
});

describe('scrubRecordingEvent (replay pipeline)', () => {
  it('(d) A1 — redacts a recorded navigation/fetch token URL', () => {
    const fetchSpan = {
      type: 5,
      data: {
        tag: 'performanceSpan',
        payload: { op: 'resource.fetch', description: `https://x/invite-preview/info/${JWT}` },
      },
    };
    const out = scrubRecordingEvent(fetchSpan);
    expect(JSON.stringify(out)).not.toContain(JWT);
    expect(JSON.stringify(out)).toContain('[REDACTED]');

    const navEvent = { data: { payload: { url: `https://x/rsvp?magic_token=${JWT}` } } };
    const out2 = scrubRecordingEvent(navEvent);
    expect(JSON.stringify(out2)).not.toContain(JWT);
    expect(JSON.stringify(out2)).toContain('[REDACTED]');
  });
});
