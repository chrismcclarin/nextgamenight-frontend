'use client';
import { useState } from 'react';

/**
 * Star rating picker with half-star precision (0-5, 0.5 increments).
 *
 * Behavior:
 * - Each star has two clickable halves: left = N - 0.5, right = N
 * - Desktop: hover preview fills up to cursor; mouseleave returns to committed value
 * - Mobile: tap commits directly (same halves; star size ≥40px)
 * - Empty state (value = 0): 5 outlined grey stars + "—" indicator
 *
 * Props:
 *   value: number (0-5, 0.5 increments)
 *   onChange: (newValue: number) => void
 *   ariaLabel?: string
 *
 * A11Y STATE, read and RECORDED by plan 88.6-33 task 3 (2026-09-16) — NOT fixed here; this is
 * outside R5's enumerated known-answer scope for phase 88.6. Routed with lines to
 * `.planning/deferred/phase-88.6.md` so it has an owning phase rather than exiting into thin air.
 *
 * CLAIM CORRECTED, and the correction is the point. An earlier version of plan 88.6-33 and its
 * threat row T-88.6-92 described this as "a rating control with no accessible names or keyboard
 * path". That is FALSE against this file and is WITHDRAWN. Three of the four questions asked came
 * back POSITIVE when read at HEAD:
 *   - are the halves real buttons?   YES — `<button type="button">` at :102-103 and :111-112.
 *   - does each have a name?         YES — a per-half `aria-label` at :107 and :116, inside a
 *                                    `role="radiogroup" aria-label` container at :70-71.
 *   - is the value exposed?          YES — `role="radio"` + `aria-checked` at :108-109 and
 *                                    :117-118, with an `aria-live="polite"` readout at :124.
 *   - is there a keyboard path?      YES, but not the RIGHT one — see residual 1.
 * Each half also carries `focus-visible:ring-2` (:104, :113), which
 * `focusAndMotionTreatment.test.ts` test 3 pins by name; do not remove it.
 *
 * (Every line cite in this block was re-derived by content AFTER this block was written — it
 * shifts the file by ~30 lines, so the numbers a reader would otherwise inherit are all wrong.)
 *
 * THE REAL RESIDUALS ARE THREE, and they are narrower than the withdrawn claim:
 *   1. TEN INDIVIDUALLY TABBABLE RADIOS. There is no roving tabindex and no Arrow-key traversal,
 *      so reaching the next control costs ten Tab presses and the group departs from the ARIA APG
 *      radiogroup pattern. This is a pattern departure, not an absent keyboard path.
 *   2. SUB-44px HIT ZONES. Each half is `w-1/2 h-full` (:104, :113) of a `w-10 h-10` star box
 *      (:79), i.e. half of 40px wide by 40px tall. That figure is ARITHMETIC FROM THE CLASS
 *      STRINGS — jsdom performs no layout and no rendered measurement was taken, so it is stated
 *      as derived, not measured. It is below the 44px floor either way.
 *   3. THE READOUT IS HOVER-DRIVEN, NOT FOCUS-DRIVEN. `setHoverValue` is wired to `onMouseEnter`
 *      only (:105, :114), so a keyboard user moving through the radios gets no live readout at
 *      all — the one affordance that would have compensated for residual 1.
 */
export default function StarRatingPicker({ value = 0, onChange, ariaLabel = 'Rating' }) {
  const [hoverValue, setHoverValue] = useState(null);
  const displayValue = hoverValue !== null ? hoverValue : value;

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
            className="relative w-10 h-10 cursor-pointer select-none"
          >
            {/* Background outline (always renders behind any fill) */}
            <StarSVG
              className="absolute inset-0 w-10 h-10 text-content-muted"
              filled={false}
            />
            {/* Full fill */}
            {filledFull && (
              <StarSVG
                className="absolute inset-0 w-10 h-10 text-amber-400"
                filled={true}
              />
            )}
            {/* Half fill (left half only) */}
            {filledHalf && (
              <StarSVG
                className="absolute inset-0 w-10 h-10 text-amber-400"
                filled={true}
                clipHalf="left"
              />
            )}
            {/* Hit zones — absolutely-positioned buttons spanning each half of the star */}
            <button
              type="button"
              className="absolute left-0 top-0 w-1/2 h-full bg-transparent border-0 p-0 m-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-400 rounded-l"
              onMouseEnter={() => handleHalfHover(starIndex, 'left')}
              onClick={() => handleHalfClick(starIndex, 'left')}
              aria-label={`${starIndex - 0.5} stars`}
              role="radio"
              aria-checked={value === starIndex - 0.5}
            />
            <button
              type="button"
              className="absolute right-0 top-0 w-1/2 h-full bg-transparent border-0 p-0 m-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-400 rounded-r"
              onMouseEnter={() => handleHalfHover(starIndex, 'right')}
              onClick={() => handleHalfClick(starIndex, 'right')}
              aria-label={`${starIndex} stars`}
              role="radio"
              aria-checked={value === starIndex}
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
