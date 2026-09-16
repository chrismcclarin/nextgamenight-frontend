'use client';

/**
 * RSVP count display component with full/compact variants.
 *
 * Full variant:  "3 going · 1 maybe · 2 can't"  (with colored text)
 * Compact variant: "3Y 1M 2N"  (abbreviated for calendar cells)
 *
 * Zero state: "No RSVPs yet" in gray text.
 *
 * @param {object} props
 * @param {{ yes?: number, maybe?: number, no?: number }} [props.rsvpSummary] - RSVP counts
 * @param {'full'|'compact'} [props.variant='full'] - Display variant
 * @param {string} [props.className] - Additional wrapper classes
 * @param {boolean} [props.inheritColor=false] - COMPACT variant only: drop the hard-coded
 *   status colours so the three spans inherit their parent's resolved colour. See the
 *   DECISION Phase 88.3-16 marker on the compact branch below.
 */
export default function RsvpCount({
  rsvpSummary,
  variant = 'full',
  className = '',
  inheritColor = false,
}) {
  const yes = rsvpSummary?.yes || 0;
  const maybe = rsvpSummary?.maybe || 0;
  const no = rsvpSummary?.no || 0;

  const hasAny = yes > 0 || maybe > 0 || no > 0;

  /* DECISION Phase 88.6-29 (R2 / UI-SPEC §4.2 vs §4.3): this component is classified as
     **Label 14**, not Caption 12, and the determination is made from the MARKUP rather than the
     component name. §4.2's closed Caption list would apply if this rendered as a chip/pill/badge;
     it does not. BOTH variants render bare `<span>`s inside a plain `flex` row — no
     `rounded-full`, no background, no border, no padding — i.e. a standalone count display, which
     is §4.3's "counts" case and Label's rung. The zero state below is the file's ONLY explicit
     size utility and stays at `text-sm`.

     THE COMPACT VARIANT AUTHORS NO SIZE AT ALL, deliberately: it inherits from its call sites, and
     one of those is the dense month tile that plan 88.6-27 folded to the 12px Caption floor
     (`CalendarMonthView.js`, V-7's reflow-checked surface). Authoring a size here would override
     that tile's ruled rung and re-open a measurement this phase already paid for. Do not "converge"
     the compact spans onto this file's rung — it is a decision, not a cleanup.

     The three `font-medium` weights below are GONE, not promoted: §4.5's EMPHASIS outcome is 400
     plus a colour token, and every one of these spans already carries its `text-content-status-*`
     token. Same call, same reason, as the count banner in `RsvpSection.js`, which renders the
     same three numbers. */
  if (!hasAny) {
    return (
      <span className={`text-content-muted text-sm ${className}`.trim()}>
        No RSVPs yet
      </span>
    );
  }

  if (variant === 'compact') {
    /* DECISION Phase 88.3-16 (owner ruling 5): `inheritColor` is an OPT-IN, DEFAULTED prop
       that omits the three hard-coded `text-content-status-*` classes so the spans inherit
       whatever colour their parent resolved to.

       WHY IT EXISTS: plan 16 gives the compact month tile the group tint, and these three
       colours are hard-coded and pass 4.5:1 only against the tile's SHIPPED
       `bg-surface-muted` ground (success 5.46, warning 5.25, error 6.37). Measured
       2026-08-27 with `src/lib/wcag.ts` against the eight pinned t = 0.70 tints
       (`colorUtils.test.ts`), EVERY success pairing (3.70-3.92) and EVERY warning pairing
       (3.55-3.76) FAIL, and 5 of 8 error pairings (4.31-4.56) fail too. Tinting the tile
       without this would have silently degraded a today-passing surface. With it, the spans
       inherit the tile's light tint-pole `#1e40af`, which measures 4.52-4.79 against all
       eight — clearing 4.5 on every one.

       WHY THE TITLE-ONLY FORK WAS INSUFFICIENT: `RsvpCount` renders its OWN colours,
       independent of the tile title, so forking only the title would have left these three
       spans on the failing status tokens. It only works because the tile's tint fork lives on
       the WRAPPER div (not the title div) — the wrapper is the shared parent both the title
       and this component inherit through.

       REJECTED: editing these spans unconditionally. This component has a SECOND call site,
       `CalendarListView.js:898`, which passes no such prop — so a DEFAULTED prop leaves that
       call site byte-identical and leaves the UNCOLOURED compact tile rendering its shipped
       success/warning/error colours exactly as today. An unconditional edit would have reached
       both.

       A decision, not a cleanup. */
    const statusClass = (token) => (inheritColor ? undefined : token);
    return (
      <div className={`flex gap-1 ${className}`.trim()}>
        {yes > 0 && <span className={statusClass('text-content-status-success')}>{yes}Y</span>}
        {maybe > 0 && <span className={statusClass('text-content-status-warning')}>{maybe}M</span>}
        {no > 0 && <span className={statusClass('text-content-status-error')}>{no}N</span>}
      </div>
    );
  }

  // Full variant
  const parts = [];
  if (yes > 0) {
    parts.push(
      <span key="yes" className="text-content-status-success">
        {yes} going
      </span>
    );
  }
  if (maybe > 0) {
    parts.push(
      <span key="maybe" className="text-content-status-warning">
        {maybe} maybe
      </span>
    );
  }
  if (no > 0) {
    parts.push(
      <span key="no" className="text-content-status-error">
        {no} can&apos;t
      </span>
    );
  }

  return (
    <div className={`flex gap-3 ${className}`.trim()}>
      {parts.map((part, i) => (
        <span key={part.key} className="flex items-center gap-1">
          {i > 0 && <span className="text-line-strong mr-2">&middot;</span>}
          {part}
        </span>
      ))}
    </div>
  );
}
