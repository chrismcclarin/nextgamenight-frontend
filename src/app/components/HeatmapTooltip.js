'use client';

import { useFloating, offset, flip, shift } from '@floating-ui/react';
import { useMemo } from 'react';

/**
 * HeatmapTooltip - Displays participant list on heatmap cell hover
 *
 * @param {Object} props
 * @param {Array} props.participants - Array of { user_id, username, preference }
 * @param {boolean} props.isOpen - Whether tooltip is visible
 * @param {HTMLElement} props.referenceElement - Element to anchor tooltip to
 */
export default function HeatmapTooltip({
  participants = [],
  isOpen,
  referenceElement,
}) {
  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    elements: {
      reference: referenceElement,
    },
  });

  // Group participants by preference
  const grouped = useMemo(() => {
    const preferred = [];
    const ifNeeded = [];

    participants.forEach((p) => {
      if (p.preference === 'preferred') {
        preferred.push(p.username || p.user_id);
      } else {
        ifNeeded.push(p.username || p.user_id);
      }
    });

    return { preferred, ifNeeded };
  }, [participants]);

  if (!isOpen || participants.length === 0) {
    return null;
  }

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm z-50 shadow-lg max-w-xs"
      role="tooltip"
    >
      {grouped.preferred.length > 0 && (
        <div className="mb-1">
          <span className="text-green-400 font-medium">Preferred: </span>
          <span>{grouped.preferred.join(', ')}</span>
        </div>
      )}
      {grouped.ifNeeded.length > 0 && (
        <div>
          <span className="text-yellow-400 font-medium">If needed: </span>
          <span>{grouped.ifNeeded.join(', ')}</span>
        </div>
      )}
      {/* Arrow indicator */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-gray-900 rotate-45" />
    </div>
  );
}

// Named export for flexibility
export { HeatmapTooltip };
