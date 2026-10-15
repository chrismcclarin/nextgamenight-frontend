// isUuid — the FE mirror of the backend's UUID_RE (plan 88.6.1-07, D-03 / AC-6 / CSPT).
//
// The accept rows are the canonical shapes the backend accepts (any case, any variant). The
// reject rows are the near-misses and the path-traversal shapes a crafted link can carry: a
// URL id that decodes to dot-segments is normalised by the browser into ANOTHER same-origin
// BFF path before the proxy's segment check sees it, so the guard has to refuse every one of
// them where the id is read. Plain `it(` lines on purpose (house count gates read that shape).
import { isUuid } from './isUuid';

const VALID = '0b4e5a52-9c8f-4f7a-8f3e-2d1c6b7a9e10';

describe('isUuid — mirrors the backend UUID_RE (88.6.1-07, D-03)', () => {
  it('U1: accepts canonical UUIDs in lower, upper and mixed case, any variant', () => {
    const accepted = [
      VALID,
      VALID.toUpperCase(),
      '0B4e5A52-9c8F-4f7A-8f3E-2d1C6b7A9e10',
      '11111111-1111-4111-8111-111111111111',
      '00000000-0000-0000-0000-000000000000',
    ];
    for (const value of accepted) {
      expect(isUuid(value), `accept ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('U2: rejects empty strings, short ids and every near-miss shape', () => {
    const rejected = [
      '',
      '1',
      'EVT1',
      'GROUP1',
      VALID.slice(0, -1), // 35 characters
      `${VALID}0`, // 37 characters, one extra hex digit
      VALID.replace(/-/g, ''), // 32 hex digits, no hyphens
      `{${VALID}}`, // braced
      `urn:uuid:${VALID}`,
      `g${VALID.slice(1)}`, // one non-hex character
    ];
    for (const value of rejected) {
      expect(isUuid(value), `reject ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('U3: rejects the path-traversal shapes (the CSPT cases)', () => {
    const rejected = [
      '../x',
      '..%2Fusers%2Fme',
      `${VALID}/../users/me`,
      '../users/me',
      `${VALID}\n`, // a trailing newline must not slip past the end anchor
      ` ${VALID}`, // a leading space
    ];
    for (const value of rejected) {
      expect(isUuid(value), `reject ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('U4: rejects non-strings and never throws', () => {
    const rejected: unknown[] = [null, undefined, 0, 123, {}, [], [VALID]];
    for (const value of rejected) {
      let out: unknown;
      expect(() => {
        out = isUuid(value);
      }, `${JSON.stringify(value)} must not throw`).not.toThrow();
      expect(out, `reject ${JSON.stringify(value)}`).toBe(false);
    }
  });
});
