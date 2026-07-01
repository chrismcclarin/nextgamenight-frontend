import type { CSSProperties } from 'react';

/**
 * Returns a CSSProperties `backgroundImage` for a user/remote URL, or
 * `undefined` on any failure (React then omits the style → graceful
 * no-background). Protocol-only allowlist: `http:`/`https:` (D-06 — group
 * backgrounds are arbitrary user-pasted URLs, so NO host restriction). The
 * validated href is wrapped in a quoted `url("…")`, so a hostile value
 * (`javascript:`, `data:`, or a declaration-breakout payload like
 * `");evil:url(//attacker)`) cannot inject a CSS declaration — it either fails
 * `new URL()` parsing or its scheme is not allowlisted, and we return
 * `undefined`. FSEC-03.
 */
export function safeBgImageStyle(
  url: string | null | undefined
): CSSProperties | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return { backgroundImage: `url("${parsed.href}")` };
  } catch {
    return undefined;
  }
}
