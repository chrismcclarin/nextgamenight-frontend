'use client';

/**
 * RSVP count display component (full variant only; the compact variant was removed with its last consumer, 88.9-28 E1a).
 *
 * Full variant:  "3 going · 1 maybe · 2 can't"  (with colored text)
 *
 * Zero state: "No RSVPs yet" in gray text.
 *
 * @param {object} props
 * @param {{ yes?: number, maybe?: number, no?: number }} [props.rsvpSummary] - RSVP counts
 * @param {'full'} [props.variant='full'] - the only variant; the compact one was removed with its last consumer (88.9-28 E1a)
 * @param {string} [props.className] - Additional wrapper classes
 */
export default function RsvpCount({
  rsvpSummary,
  variant = 'full',
  className = '',
}) {
  const yes = rsvpSummary?.yes || 0;
  const maybe = rsvpSummary?.maybe || 0;
  const no = rsvpSummary?.no || 0;

  const hasAny = yes > 0 || maybe > 0 || no > 0;

  /* DECISION Phase 88.6-29 (R2 / UI-SPEC §4.2 vs §4.3): this component is classified as
     **Label 14**, not Caption 12, and the determination is made from the MARKUP rather than the
     component name. §4.2's closed Caption list would apply if this rendered as a chip/pill/badge;
     it does not. The full variant renders bare `<span>`s inside a plain `flex` row — no
     `rounded-full`, no background, no border, no padding — i.e. a standalone count display, which
     is §4.3's "counts" case and Label's rung. The zero state below is the file's ONLY explicit
     size utility and stays at `text-sm`.

     AMENDED Phase 88.9-28 (owner pick E1a): the compact variant, and the inherit-the-tile's-rung rule it carried, were removed with the compact month tile's count; the Label-14 classification of the full variant stands.

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
