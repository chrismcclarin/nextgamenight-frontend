'use client';

/**
 * ThresholdSlider - Range input for filtering heatmap by minimum participants
 *
 * @param {Object} props
 * @param {number} props.value - Current threshold value
 * @param {function} props.onChange - Handler called with new value
 * @param {number} props.min - Minimum slider value (default: 1)
 * @param {number} props.max - Maximum slider value (total members)
 * @param {number} props.viableCount - Number of slots meeting current threshold
 * @param {boolean} props.disabled - Disable interactions
 */
export default function ThresholdSlider({
  value,
  onChange,
  min = 1,
  max,
  viableCount,
  disabled = false,
}) {
  // Handle edge case where max is less than min
  const safeMax = Math.max(max || 1, min);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <label
          htmlFor="threshold-slider"
          className="text-sm text-content-secondary whitespace-nowrap"
        >
          Minimum participants:
        </label>
        <input
          id="threshold-slider"
          type="range"
          min={min}
          max={safeMax}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          disabled={disabled}
          className="flex-1 h-2 bg-surface-elevated rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed accent-blue-600"
          aria-valuemin={min}
          aria-valuemax={safeMax}
          aria-valuenow={value}
          aria-label={`Minimum participants: ${value} of ${safeMax}`}
        />
        {/* DECISION Phase 88.6-25 (UI-SPEC 4.3 / 4.5): this value display is classified
            LABEL 14 and takes the 700 weight, and BOTH halves are choices.

            SIZE — Label 14, chosen OVER Caption 12. It is a COUNT, which 4.3 puts on the Label
            rung; the Caption rung's dense-grid role (D-01's closed list) names the month tile,
            the week strip and the heatmap legend, and this is none of them — it is a single row
            of control chrome beside a full-width slider whose own label element is 14. Dropping
            it to 12 would make the live value smaller than the static label naming it.

            WEIGHT — 700, chosen OVER 4.5's emphasis outcome (400 plus a colour token). The
            emphasis outcome needs a colour to do the work the weight was doing, and this span
            carries the SAME text-content-secondary token as the label at the other end of the
            row — so dropping to 400 would leave the live value typographically identical to the
            static label naming it, with nothing distinguishing them. This is 4.5's hierarchy
            case, and converging it to 400 is a decision, not a cleanup. */}
        <span className="text-sm font-bold min-w-[60px] text-content-secondary text-right">
          {value} / {safeMax}
        </span>
      </div>

      {/* Live region for screen readers */}
      <div
        className="text-sm text-content-secondary"
        role="status"
        aria-live="polite"
      >
        {viableCount === 0 ? (
          <span className="text-amber-600">
            No slots meet minimum of {value} participants
          </span>
        ) : viableCount === 1 ? (
          <span>
            1 viable slot meets minimum of {value} participant{value > 1 ? 's' : ''}
          </span>
        ) : (
          <span>
            {viableCount} viable slots meet minimum of {value} participant{value > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

// Named export for flexibility
export { ThresholdSlider };
