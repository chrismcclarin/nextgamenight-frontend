'use client';
import { useState } from 'react';

/**
 * Star rating picker with half-star precision (0-5, 0.5 increments).
 *
 * Behavior:
 * - Each star has two clickable halves: left = N - 0.5, right = N
 * - Desktop: hover preview fills up to cursor; mouseleave returns to committed value
 * - Mobile: tap commits directly (same halves; star box 48px, each half 24 x 48)
 * - Empty state (value = 0): 5 outlined grey stars + "—" indicator
 *
 * Props:
 *   value: number or numeric string (0-5, 0.5 increments; the API sends a saved rating as "4.0"),
 *          converted to a number once at the top of the component
 *   onChange: (newValue: number) => void
 *   ariaLabel?: string
 *
 * A11Y STATE, read and RECORDED by plan 88.6-33 task 3 (2026-09-16) — NOT fixed here; this is
 * outside R5's enumerated known-answer scope for phase 88.6. Routed to
 * planning:.planning/deferred/phase-88.9.md ("ten half-star radios") so it has an owning phase
 * (Phase 88.9) rather than exiting into thin air.
 *
 * CLAIM CORRECTED, and the correction is the point. An earlier version of plan 88.6-33 and its
 * threat row T-88.6-92 described this as "a rating control with no accessible names or keyboard
 * path". That is FALSE against this file and is WITHDRAWN. Three of the four questions asked came
 * back POSITIVE when read at HEAD:
 *   - are the halves real buttons?   YES — two `<button type="button">` per star, the left half
 *                                    this file ("handleHalfClick(starIndex, 'left')") and the right half
 *                                    this file ("handleHalfClick(starIndex, 'right')").
 *   - does each have a name?         YES — each half button carries its own `aria-label`, inside a
 *                                    `role="radiogroup"` container named by this file ("aria-label={ariaLabel}").
 *   - is the value exposed?          YES — each half button carries `role="radio"` + `aria-checked`,
 *                                    with an `aria-live="polite"` readout at this file ("displayValue.toFixed(1)").
 *   - is there a keyboard path?      YES, but not the RIGHT one — see residual 1.
 * Each half button also carries `focus-visible:ring-2` in the house colour (focus-visible:ring-focus-ring), which
 * src/app/focusAndMotionTreatment.test.ts ("the three pre-88-28 compliant files still carry their") pins by name;
 * do not remove it. AMENDED Phase 88.9-34: the amber-400 ring it shipped with measured 1.67:1 on the
 * white dialog in light and 1.00 against a filled star, under the 3:1 non-text floor; the house ring
 * reads 7.79 / 4.67 in light and is the same amber-400 in dark.
 *
 * (Every cite in this block is a same-file anchor, re-read at FE e70c9a3 on 2026-10-24; the line
 * numbers an earlier version carried had drifted ~10 lines, which is why it no longer uses them.)
 *
 * THE REAL RESIDUALS ARE THREE, and they are narrower than the withdrawn claim:
 *   1. TEN INDIVIDUALLY TABBABLE RADIOS. There is no roving tabindex and no Arrow-key traversal,
 *      so reaching the next control costs ten Tab presses and the group departs from the ARIA APG
 *      radiogroup pattern. This is a pattern departure, not an absent keyboard path.
 *   2. SUB-44px HIT ZONES — RULED Phase 88.9-34 (owner pick O15b, 88.9-PICKS-B8B.json, 2026-11-07):
 *      the star box is 48x48 and each half 24 wide by 48 tall
 *      (this file ("relative w-12 h-12 cursor-pointer select-none")), chosen OVER the shipped 40px
 *      star (20 x 40 halves). 24 CSS px meets WCAG 2.2 SC 2.5.8; the whole star clears the 44
 *      floor; a half alone does not reach 44 wide, which the owner ruled on the rendered page.
 *      Still arithmetic from the class strings in jsdom; the rendered size is pinned by
 *      e2e/touch-targets.spec.ts (stars 48).
 *   3. THE READOUT IS HOVER-DRIVEN, NOT FOCUS-DRIVEN. `setHoverValue` is wired to `onMouseEnter`
 *      only (this file ("handleHalfHover(starIndex, 'left')"), this file ("handleHalfHover(starIndex, 'right')")),
 *      so a keyboard user moving through the radios gets no live readout at
 *      all — the one affordance that would have compensated for residual 1.
 */
export default function StarRatingPicker({ value = 0, onChange, ariaLabel = 'Rating' }) {
  const [hoverValue, setHoverValue] = useState(null);
  // DECISION quick-260930-w9v: the picker turns its value prop into a number itself, chosen over
  // trusting every caller to pass one. A saved rating reaches the page as the API's DECIMAL string
  // ("4.0"); the readout's toFixed threw on it and crashed the edit dialog, and the strict-equality
  // radio checks never matched it. gameDetail also converts at its prefill; keeping both is
  // deliberate, so removing either is a decision, not a cleanup.
  const committedValue = Number(value) || 0;
  const displayValue = hoverValue !== null ? hoverValue : committedValue;

  const stars = [1, 2, 3, 4, 5];

  const handleHalfHover = (starIndex, half) => {
    // half: 'left' = .5 of star N; 'right' = full star N
    const v = half === 'left' ? starIndex - 0.5 : starIndex;
    setHoverValue(v);
  };

  const handleHalfClick = (starIndex, half) => {
    const v = half === 'left' ? starIndex - 0.5 : starIndex;
    if (typeof onChange === 'function') onChange(v);
  };

  const handleLeave = () => setHoverValue(null);

  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseLeave={handleLeave}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {stars.map((starIndex) => {
        const filledFull = displayValue >= starIndex;
        const filledHalf = !filledFull && displayValue >= starIndex - 0.5;
        return (
          <div
            key={starIndex}
            className="relative w-12 h-12 cursor-pointer select-none"
          >
            {/* Background outline (always renders behind any fill) */}
            <StarSVG
              className="absolute inset-0 w-12 h-12 text-content-muted"
              filled={false}
            />
            {/* Full fill */}
            {filledFull && (
              <StarSVG
                className="absolute inset-0 w-12 h-12 text-amber-400"
                filled={true}
              />
            )}
            {/* Half fill (left half only) */}
            {filledHalf && (
              <StarSVG
                className="absolute inset-0 w-12 h-12 text-amber-400"
                filled={true}
                clipHalf="left"
              />
            )}
            {/* Hit zones — absolutely-positioned buttons spanning each half of the star */}
            <button
              type="button"
              className="absolute left-0 top-0 w-1/2 h-full bg-transparent border-0 p-0 m-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring rounded-l"
              onMouseEnter={() => handleHalfHover(starIndex, 'left')}
              onClick={() => handleHalfClick(starIndex, 'left')}
              aria-label={`${starIndex - 0.5} stars`}
              role="radio"
              aria-checked={committedValue === starIndex - 0.5}
            />
            <button
              type="button"
              className="absolute right-0 top-0 w-1/2 h-full bg-transparent border-0 p-0 m-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring rounded-r"
              onMouseEnter={() => handleHalfHover(starIndex, 'right')}
              onClick={() => handleHalfClick(starIndex, 'right')}
              aria-label={`${starIndex} stars`}
              role="radio"
              aria-checked={committedValue === starIndex}
            />
          </div>
        );
      })}
      {/* Hover/value indicator — shipped as a small numeric next to the stars (D-STAR-02 Claude's discretion) */}
      <span className="ml-2 text-sm text-content-muted tabular-nums" aria-live="polite">
        {displayValue > 0 ? displayValue.toFixed(1) : '—'}
      </span>
    </div>
  );
}

function StarSVG({ className, filled, clipHalf }) {
  // Standard 5-point star path, 24x24 viewBox.
  const d = 'M12 2l2.9 6.9L22 10l-5.5 4.8L18 22l-6-3.6L6 22l1.5-7.2L2 10l7.1-1.1L12 2z';
  // clipPath: inset(top right bottom left) — clip away the right 50% so only the left half renders.
  const styles = clipHalf === 'left' ? { clipPath: 'inset(0 50% 0 0)' } : undefined;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      style={styles}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
