import type { CSSProperties } from 'react';

/**
 * The single protocol allow-list for every user/remote image URL this app
 * renders — CSS `background-image` and `<img src>` alike. Both call sites go
 * through `isAllowedImageUrl` below; the list is deliberately spelled ONCE so a
 * scheme can never be permitted in one surface and blocked in the other.
 * Protocol-only, with NO host restriction (D-06 — group backgrounds and group
 * profile pictures are arbitrary user-pasted URLs, so an allowed scheme on any
 * host is the intended behaviour).
 */
export const ALLOWED_IMAGE_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/**
 * Base used ONLY to resolve genuinely relative references when a caller opts in
 * via `allowRelative`. It is never emitted: a relative ref is validated against
 * this base and then handed to the DOM in its ORIGINAL relative form, so it
 * still resolves against the real page origin at render time. `.invalid` is the
 * RFC 2606 reserved TLD, so this can never name a resolvable host.
 */
const RELATIVE_BASE = 'https://relative.invalid';

/**
 * True when `url` is safe to hand to an image sink under the allow-list above.
 *
 * `allowRelative` (default false) decides whether a relative reference such as
 * `/uploads/pic.png` is acceptable. Passing a base to `new URL()` does NOT
 * weaken the scheme check: per WHATWG, an ABSOLUTE url ignores the base
 * entirely, so `javascript:alert(1)` still parses with protocol `javascript:`
 * and fails the allow-list. Verified against the parser for the obfuscation
 * forms browsers themselves normalise before dispatch — leading whitespace,
 * embedded TAB and embedded NEWLINE split through the middle of the word, and
 * mixed case — all of which resolve to `javascript:` here exactly as they do in
 * the browser. Only a reference with no scheme of its own adopts the base.
 */
export function isAllowedImageUrl(
  url: string | null | undefined,
  options: { allowRelative?: boolean } = {}
): boolean {
  if (!url) return false;
  try {
    const parsed = options.allowRelative
      ? new URL(url, RELATIVE_BASE)
      : new URL(url);
    return ALLOWED_IMAGE_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Returns a CSSProperties `backgroundImage` for a user/remote URL, or
 * `undefined` on any failure (React then omits the style → graceful
 * no-background). The validated href is wrapped in a quoted `url("…")`, so a
 * hostile value (`javascript:`, `data:`, or a declaration-breakout payload like
 * `");evil:url(//attacker)`) cannot inject a CSS declaration — it either fails
 * `new URL()` parsing or its scheme is not allowlisted, and we return
 * `undefined`. FSEC-03.
 *
 * Relative refs stay REJECTED here (`allowRelative` left at its default). That
 * is the pre-existing FSEC-03 behaviour and it is preserved deliberately: a
 * group background is an arbitrary pasted URL, so a bare relative string is a
 * malformed value rather than a legitimate one. `SafeImage` opts in instead,
 * because six of its call sites admit `/`-prefixed values by construction.
 */
export function safeBgImageStyle(
  url: string | null | undefined
): CSSProperties | undefined {
  if (!isAllowedImageUrl(url)) return undefined;
  // Safe: isAllowedImageUrl only returns true when this same parse succeeds.
  return { backgroundImage: `url("${new URL(url as string).href}")` };
}
