'use client';

// ReadCell — presentational read/intensity heatmap cell (PRIM-01, D-04/D-06).
//
// A THIN React.memo wrapper over the engine: keyboard/roving comes from
// `useHeatmapCell`, color comes from `availabilityColor` (applied VERBATIM — no
// cn/tailwind-merge), and the analog markup (role="gridcell", HeatmapTooltip +
// triggerRef seam) is carried over from HeatmapCell.js so this wrapper converges
// the existing read cells rather than redesigning them.
//
// Two modes share ONE color/ARIA path:
//   - roving (default): the container (WeekGrid) owns focusedCoord/cellRefs and
//     hands STABLE onMove/onSelect; arrow keys move focus across the grid.
//   - roving={false}: passive read-summary mode (EventHeatmapBackground / the
//     locked 72-02 Tab+focus+Esc model). A STATIC tabIndex is rendered, NO
//     arrow-key roving handler is attached, and no focusedCoord/cellRefs/onMove
//     container is required.
//
// React.memo is explicit and load-bearing: it carries over TimeSlotCell's
// drag-render guarantee — given stable handler props + an unchanged value, a cell
// does NOT re-render when a sibling changes, so a pointer-paint drag re-renders
// only the painted cell.

import React, { memo } from 'react';
import HeatmapTooltip from '../HeatmapTooltip';
import { intensityColor, mergedCellColor } from '@/lib/availabilityColor';
import { useHeatmapCell } from './useHeatmapCell';

const noop = () => {};

interface ReadCellBaseProps {
  /** This cell's row index (0-based). */
  row: number;
  /** This cell's column index (0-based). */
  col: number;
  /** Total rows in the grid. */
  rows: number;
  /** Total columns in the grid. */
  cols: number;
  /** Whether this cell currently holds roving focus (roving mode only). */
  focused?: boolean;
  /** Inert cell: tabIndex -1, no keyboard. */
  disabled?: boolean;
  /**
   * Roving keyboard nav. Default `true` (container-driven arrow roving).
   * `false` = passive read-summary mode (72-02): static tabIndex, no arrow
   * handler, no focusedCoord/cellRefs/onMove container needed.
   */
  roving?: boolean;
  /** tabIndex used ONLY when `roving === false`. Default 0. */
  staticTabIndex?: number;
  /** Container handler: called with the clamped target (row, col) on a nav key. */
  onMove?: (row: number, col: number) => void;
  /** Container handler: Enter/Space activation (open tooltip / focus). */
  onSelect?: () => void;
  /** Accessible label describing the cell's intensity. */
  ariaLabel?: string;
  /** Tooltip body (participant list, etc.). */
  tooltipContent?: React.ReactNode;
  /** Tooltip styling variant forwarded to HeatmapTooltip (merged-grid mobile tone). */
  tone?: 'default' | 'mobile';
  /** Forwarded to HeatmapTooltip so the grid can register the cell's DOM node. */
  triggerRef?: React.Ref<HTMLDivElement>;
  /**
   * Structural cell classes (dims / border / flex / text-color). Applied
   * BEFORE the color class so the verbatim availabilityColor string survives
   * (no cn/tailwind-merge). When omitted, the cell's className is EXACTLY the
   * color string (the 84-05 byte-identical contract for WeekGrid).
   */
  className?: string;
  /** Inline style merged after the fill defaults (e.g. minHeight on the passive overlay). */
  style?: React.CSSProperties;
  /**
   * Fill the parent (width/height 100%). Default `true` for the WeekGrid
   * sized-wrapper pattern. Prod div-grids that size the cell via `className`
   * (HeatmapGrid w-24/h-12) pass `fill={false}`.
   */
  fill?: boolean;
  /** Cell content rendered inside the colored div (e.g. the participant-count badge). */
  children?: React.ReactNode;
}

export interface IntensityReadCellProps extends ReadCellBaseProps {
  variant?: 'intensity';
  participantCount: number;
  preferredCount: number;
  totalMembers: number;
}

export interface MergedReadCellProps extends ReadCellBaseProps {
  variant: 'merged';
  availableCount: number;
  totalMembers: number;
}

export type ReadCellProps = IntensityReadCellProps | MergedReadCellProps;

function resolveColor(props: ReadCellProps): string {
  if (props.variant === 'merged') {
    return mergedCellColor(props.availableCount, props.totalMembers);
  }
  return intensityColor(props.participantCount, props.preferredCount, props.totalMembers);
}

export const ReadCell = memo(function ReadCell(props: ReadCellProps) {
  const {
    row,
    col,
    rows,
    cols,
    focused = false,
    disabled = false,
    roving = true,
    staticTabIndex = 0,
    onMove = noop,
    onSelect = noop,
    ariaLabel,
    tooltipContent = null,
    tone = 'default',
    triggerRef,
    className,
    style,
    fill = true,
    children = null,
  } = props;

  // Hook is called unconditionally (rules of hooks). In passive mode we simply
  // ignore its onKeyDown and use a static tabIndex instead.
  const { tabIndex: rovingTabIndex, onKeyDown: rovingKeyDown } = useHeatmapCell({
    row,
    col,
    rows,
    cols,
    focused,
    disabled,
    onMove,
    onSelect,
  });

  const tabIndex = roving ? rovingTabIndex : disabled ? -1 : staticTabIndex;
  const onKeyDown = roving ? rovingKeyDown : undefined;

  const colorClass = resolveColor(props);
  // Color string applied VERBATIM (no cn/tailwind-merge). When the consumer
  // supplies structural classes they are PREPENDED, so the color substring
  // survives byte-identical and the no-className path stays exactly the color.
  const fullClassName = className ? `${className} ${colorClass}` : colorClass;

  const cell = (
    <div
      className={fullClassName}
      role="gridcell"
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={{ ...(fill ? { width: '100%', height: '100%' } : {}), ...style }}
    >
      {children}
    </div>
  );

  return (
    <HeatmapTooltip content={tooltipContent} ariaLabel={ariaLabel} tone={tone} triggerRef={triggerRef}>
      {cell}
    </HeatmapTooltip>
  );
});

export default ReadCell;
