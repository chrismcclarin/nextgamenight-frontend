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
 */
export default function RsvpCount({ rsvpSummary, variant = 'full', className = '' }) {
  const yes = rsvpSummary?.yes || 0;
  const maybe = rsvpSummary?.maybe || 0;
  const no = rsvpSummary?.no || 0;

  const hasAny = yes > 0 || maybe > 0 || no > 0;

  if (!hasAny) {
    return (
      <span className={`text-content-muted text-sm ${className}`.trim()}>
        No RSVPs yet
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`flex gap-1 ${className}`.trim()}>
        {yes > 0 && <span className="text-status-success">{yes}Y</span>}
        {maybe > 0 && <span className="text-status-warning">{maybe}M</span>}
        {no > 0 && <span className="text-status-error">{no}N</span>}
      </div>
    );
  }

  // Full variant
  const parts = [];
  if (yes > 0) {
    parts.push(
      <span key="yes" className="text-status-success font-medium">
        {yes} going
      </span>
    );
  }
  if (maybe > 0) {
    parts.push(
      <span key="maybe" className="text-status-warning font-medium">
        {maybe} maybe
      </span>
    );
  }
  if (no > 0) {
    parts.push(
      <span key="no" className="text-status-error font-medium">
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
