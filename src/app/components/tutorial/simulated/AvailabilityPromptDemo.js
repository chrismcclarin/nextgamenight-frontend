'use client';

import { Heading } from '../../../../components/ui/Heading';

import TutorialGrid from './TutorialGrid';
import { AVAILABILITY_DRAG_PATH } from '../mockData';

/**
 * AvailabilityPromptDemo — Step 2 of 5.
 *
 * Shows how a single member fills out an availability prompt. Animates a
 * click-drag across Friday 6:00 PM - 8:30 PM (matching production's
 * pointerdown→pointerenter paint mechanic). Cells turn bg-green-300 (the
 * "preferred" preference color from the real AvailabilityGrid; in dark its
 * mid green, since 88.9-52 N1b) one at a time
 * so the user sees the drag motion, not a flash-fill.
 *
 * Stage progression (driven by parent timer):
 *   0 - empty grid
 *   1-N - drag advances to AVAILABILITY_DRAG_PATH[N-1]
 *   AVAILABILITY_DRAG_PATH.length+1 - all painted, "Save" button highlighted
 *
 * @param {{ stage: number }} props - `stage` is the current animation stage. 0 = empty.
 */
export default function AvailabilityPromptDemo({ stage }) {
  // How many cells have been "painted" so far (0..AVAILABILITY_DRAG_PATH.length)
  const paintedCount = Math.min(stage, AVAILABILITY_DRAG_PATH.length);
  const allPainted = paintedCount >= AVAILABILITY_DRAG_PATH.length;

  // Set of "rowIdx-colIdx" keys for fast lookup in renderCell
  const paintedKeys = new Set(
    AVAILABILITY_DRAG_PATH.slice(0, paintedCount).map(([r, c]) => `${r}-${c}`)
  );

  // The "cursor" position — the most recently painted cell (or null if not started)
  const cursor = paintedCount > 0 ? AVAILABILITY_DRAG_PATH[paintedCount - 1] : null;

  const renderCell = (row, col) => {
    const isPainted = paintedKeys.has(`${row}-${col}`);
    const isCursor = cursor && cursor[0] === row && cursor[1] === col && !allPainted;

    if (isPainted) {
      // DECISION Phase 88.9-52 (N1b, owner pick Mid, 2026-11-17): a painted demo cell takes the real
      // grid's dark Preferred fill (src/app/components/AvailabilityGrid.js ("const CELL_PREFERRED_CLASS =")),
      // chosen OVER leaving the bare light colour, which showed bright mint in dark: a look the real
      // grid no longer has. Light is unchanged. The heatmap demos' green count ramp is a different
      // thing and is left alone.
      // AMENDED Phase 88.9-52 (R4 S4, the round-3 capture): in dark the cell's EDGE follows too. It
      // kept the light mint edge (border-green-400, #4ade80), so a painted cell still glowed at its
      // rim, which the real grid's cells and its Preferred legend swatch
      // (src/app/components/AvailabilityGrid.js ("bg-green-300 dark:bg-surface-avail-preferred border border-line rounded-xs")) do not.
      // The edge is the plain line in dark, the one every unpainted demo cell has. REJECTED: no
      // edge at all in dark (the demo grid draws an edge on every cell, so a painted one would
      // shrink by a pixel). Light keeps its mint edge.
      return {
        className: 'bg-green-300 dark:bg-surface-avail-preferred border-green-400 dark:border-line',
        content: '',
      };
    }
    if (isCursor) {
      return {
        className: 'bg-green-200 border-green-400 ring-2 ring-green-500',
        content: '',
      };
    }
    return {
      className: 'bg-surface-elevated border-line',
      content: '',
    };
  };

  return (
    <div className="text-center">
      {/* Page header — mirrors the magic-link check-in availability form so
          users recognize the surface they'll actually land on after tapping a
          check-in. */}
      <div className="bg-surface-card border border-line rounded-t-card px-4 py-3 inline-block">
        {/* `size="label"` is passed EXPLICITLY and is not the primitive's derived value:
            level 3 derives `heading` (20), which would be a silent +6px on a simulated
            surface. §4.4's "h3 @ 14 stays" row is the rule, so 14 is where it already
            renders and where it stays. */}
        <Heading level={3} size="label" className="text-content-primary mb-0.5">
          When are you available this week?
        </Heading>
        <p className="text-xs text-content-muted">Group: Tabletop Crew</p>
      </div>

      {/* Toolbar row — paint mode toggle (matches real AvailabilityGrid) */}
      {/* DECISION Phase 88.9-52 (R4 S4, the round-3 capture: in dark this chip was still the light
          mint pill): in dark it wears the tokens the real Adding: Preferred toggle wears
          (src/app/components/AvailabilityGrid.js ("dark:bg-surface-pill-green dark:enabled-hover:bg-surface-pill-green dark:border-status-success dark:text-content-pill-green")),
          less the hover one: this chip is a picture of the toggle, not a control. Chosen OVER
          leaving the light pill on the dark card, a state the product no longer has. From the
          token values, dark: the words on the fill 5.94, the edge on the card 6.08, the edge on
          the fill 3.16. Light is unchanged (6.49). */}
      <div className="bg-surface-card border-x border-line px-3 py-1.5 inline-block">
        <div className="flex items-center justify-end">
          <span className="px-2 py-0.5 bg-green-100 border border-green-400 text-green-800 dark:bg-surface-pill-green dark:border-status-success dark:text-content-pill-green rounded-sm text-xs font-bold">
            Adding: Preferred
          </span>
        </div>
      </div>

      <div className="-mt-px">
        <TutorialGrid renderCell={renderCell} />
      </div>

      {/* DECISION Phase 88.6-35 (D49-b, owner ruling 2026-09-09 option i): the armed state's
          `shadow-md` below becomes `shadow-theme-md`. `shadow-md` is Tailwind v4's own INLINED
          black scale, not the project's re-tinted ladder — v4 inlines its built-in shadow values
          into its built-in utilities, so `--shadow-theme-md` never reaches a `shadow-md`
          (src/app/globals.css ("DECISION Phase 87.7 (Plan 06, RESEARCH Pitfall 2)")). THE SHADOW'S HUE CHANGES in both themes; that is the point of
          the ruling and is disclosed for `/gsd-ui-review`.

          NO HOVER PIN, deliberately: this is a SIMULATED chip surface inside an animation with
          `disabled` on it and no hover state at all, and it is not a `.btn`, so UI-SPEC §3.4
          rule 2 (which exists because `Button`'s cva base would shrink a declared `lg` on
          hover) has nothing to act on here. Adding one would be inventing an interaction on a
          control that cannot be interacted with. Separate item from `LandingPage.js`'s
          `hover:shadow-xl`, which is the genuine off-tier fourth-rung case (D-14b). */}
      {/* Save button — highlighted when drag is complete */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          disabled
          className={`px-4 py-1.5 text-xs font-bold rounded-btn transition-all duration-300 ${
            allPainted
              ? 'bg-btn-primary text-btn-primary-content shadow-theme-md scale-105'
              : 'bg-surface-elevated text-content-muted'
          }`}
        >
          Save availability
        </button>
      </div>
    </div>
  );
}
