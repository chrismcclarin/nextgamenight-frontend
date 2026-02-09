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
          className="text-sm font-medium text-gray-700 whitespace-nowrap"
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
          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed accent-blue-600"
          aria-valuemin={min}
          aria-valuemax={safeMax}
          aria-valuenow={value}
          aria-label={`Minimum participants: ${value} of ${safeMax}`}
        />
        <span className="text-sm font-medium min-w-[60px] text-gray-700 text-right">
          {value} / {safeMax}
        </span>
      </div>

      {/* Live region for screen readers */}
      <div
        className="text-sm text-gray-600"
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
