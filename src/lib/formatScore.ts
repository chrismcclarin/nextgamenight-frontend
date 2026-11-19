// DECISION Phase 88.9-65 (X50, owner 2026-11-13: If so, I think we just remove them.): display-only and string-based, chosen OVER Number(...).toString() (no binary round trip) and OVER a per-site strip; storage, entry (step 0.01), filter and sorts unchanged; a non-decimal string shows as received.

/** An optional minus, digits, and an optional fraction (a bare trailing point included). */
const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d*))?$/;

/**
 * The one score display formatter: a stored score as a person would write it.
 *
 * The backend returns a score as two-decimal text (57.00). This drops a fraction's trailing
 * zeros and a bare trailing point, and nothing else: 57.00 reads 57, 57.50 reads 57.5, 57.25
 * stays 57.25, and an integer keeps its own zeros (100 stays 100). The digits are never parsed
 * to a number, so no value can change on the way to the screen.
 *
 * @param value - the score as received: text from the API, a number, or nothing
 * @returns the text to show, or null when there is no score to show (null, undefined, a blank
 *   string, a non-finite number, or a value that is neither text nor a number). Text that is not
 *   a plain decimal is returned trimmed, as received.
 */
export function formatScore(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  const decimal = DECIMAL_TEXT.exec(text);
  if (!decimal) return text;
  const [, sign, whole, fraction = ''] = decimal;
  const kept = fraction.replace(/0+$/, '');
  const digits = kept === '' ? whole : `${whole}.${kept}`;
  // A zero is never printed with a sign.
  return sign === '-' && /^[0.]*$/.test(digits) ? digits : `${sign}${digits}`;
}
