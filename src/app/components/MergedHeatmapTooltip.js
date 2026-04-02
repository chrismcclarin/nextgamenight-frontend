'use client';

import { useFloating, offset, flip, shift } from '@floating-ui/react';

/**
 * MergedHeatmapTooltip - Floating tooltip showing available member names
 * on desktop hover over a heatmap cell.
 *
 * @param {Object} props
 * @param {Array} props.members - Array of { user_id, username }
 * @param {boolean} props.isOpen - Whether tooltip is visible
 * @param {HTMLElement} props.referenceElement - Element to anchor tooltip to
 */
export default function MergedHeatmapTooltip({ members = [], isOpen, referenceElement }) {
  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 5 })],
    elements: {
      reference: referenceElement,
    },
  });

  if (!isOpen || members.length === 0) {
    return null;
  }

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="bg-surface-elevated text-content-primary rounded-card shadow-theme-lg p-2 text-sm z-50 max-w-xs"
      role="tooltip"
    >
      <div>{members.map((m) => m.username || m.user_id).join(', ')}</div>
      {/* Arrow indicator */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-surface-elevated rotate-45" />
    </div>
  );
}
