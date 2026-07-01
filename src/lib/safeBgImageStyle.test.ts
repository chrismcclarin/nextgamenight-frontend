// Behavior pins for the FSEC-03 / D-06 protocol-only background-image sanitizer.
// These assert that hostile schemes and declaration-breakout payloads cannot
// produce a CSS declaration (helper returns undefined → React omits the style),
// while legitimate http(s) URLs yield a quoted `url("…")` backgroundImage.
//
// globals: true — describe/it/expect are ambient (no import needed).
import { safeBgImageStyle } from './safeBgImageStyle';

describe('safeBgImageStyle — protocol-only allowlist (D-06)', () => {
  describe('accepts http(s) URLs', () => {
    it('wraps an https URL in a quoted url("…")', () => {
      expect(safeBgImageStyle('https://i.imgur.com/x.png')).toEqual({
        backgroundImage: 'url("https://i.imgur.com/x.png")',
      });
    });

    it('allows http (no host restriction — arbitrary user-pasted URLs)', () => {
      const style = safeBgImageStyle('http://example.com/x.png');
      expect(style).toBeDefined();
      expect(style?.backgroundImage).toBe('url("http://example.com/x.png")');
    });
  });

  describe('rejects scheme-abuse and breakout payloads', () => {
    it('rejects javascript: URLs', () => {
      expect(safeBgImageStyle('javascript:alert(1)')).toBeUndefined();
    });

    it('rejects data: URLs (scheme not allowlisted)', () => {
      expect(
        safeBgImageStyle('data:image/png;base64,iVBORw0KGgo=')
      ).toBeUndefined();
    });

    it('rejects a declaration-breakout payload (unparseable / disallowed scheme)', () => {
      expect(safeBgImageStyle('");evil:url(//attacker)')).toBeUndefined();
    });
  });

  describe('rejects falsy / empty input', () => {
    it('returns undefined for null', () => {
      expect(safeBgImageStyle(null)).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(safeBgImageStyle(undefined)).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
      expect(safeBgImageStyle('')).toBeUndefined();
    });
  });
});
