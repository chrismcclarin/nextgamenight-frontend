/**
 * The single definition of how an RSVP status LOOKS and READS: its copy, its text
 * colour, its active/hover treatment, its button label and its section heading.
 *
 * Consumers (this is the ONE definition — nobody re-declares these strings):
 *
 *   1. `src/app/components/RsvpSection.js` — the event page's RSVP strip, where this
 *      object used to live as a `const` inside the component body.
 *   2. `src/app/components/NextGameNightCard.tsx` (Phase 88.5) — the home hero card's
 *      RSVP control.
 *
 * The carried `DECISION Phase 87.7 D-18` marker and the Phase 88.5 notes below are kept
 * as line comments, not folded into this block, so the 87.7 text stays byte-verbatim:
 * it contains literal `*` + `/` sequences that would terminate a block comment.
 */

// DECISION Phase 87.7 D-18 (object-literal shape): `activeBg` and `hoverBg` are EMPTY STRINGS
// on purpose, not by accident. They held `bg-status-*/10` / `hover:bg-status-*/10`, which on
// Tailwind v3 generated no class at all (a `/N` modifier on a `var()`-backed colour), so these
// rows have always rendered untinted. The tokens were REMOVED rather than: (a) dropped to their
// base class, which paints a SOLID status-coloured block — the exact regression being avoided; or
// (b) reimplemented via `color-mix`, a deliberate visual change this phase forbids. The KEYS are
// kept with '' rather than deleted so consumers reading `cfg.activeBg` / `cfg.hoverBg` still get a
// string. Class strings living in an object literal — not a className attribute — is why the
// census sweep is whole-file; a className-scoped matcher finds none of these five sites.
// Designing the real tints is PHASE 88's; full site list in
// `.planning/phases/87.7-*/87.7-OPACITY-CENSUS.md`. One of exactly two markers for this strip
// (see ParticipantRow.js for the className shape). Filling these back in is a decision, not a
// cleanup.
//
// DECISION Phase 88.5 (SPEC Req 4 / D-07): this object MOVED here out of the `RsvpSection`
// component body — it is not a copy; `RsvpSection.js` now imports it. Chosen OVER leaving it
// there and giving the home hero card its own private `{yes, no}` map. That private map would
// be the THIRD status idiom, which is exactly the drift `DECISION Phase 88-27` exists to
// prevent. Two consumers now read one object, so the hero and the event page cannot disagree
// about what "You're going!" looks like or says.
//
// DECISION Phase 88.5 (carried-record note): the `DECISION Phase 87.7 D-18` marker above is
// reproduced VERBATIM from `RsvpSection.js:105-117`, including the part that is now KNOWN
// STALE — it says `activeBg`/`hoverBg` are empty strings, and today they are real class
// strings (`bg-status-success-subtle` and friends). Do NOT "helpfully" correct it here.
// Phase 88.6's docs pass owns that fix; editing it in this phase de-syncs the two phases'
// records of the same decision.

export interface RsvpStatusStyle {
  /** First-person confirmation shown above the button group. */
  label: string;
  textColor: string;
  activeBg: string;
  activeBorder: string;
  hoverBg: string;
  /** The toggle button's own text. */
  buttonText: string;
  /** Heading for this status's group in the respondent list. */
  sectionTitle: string;
}

export type RsvpStatusKey = 'yes' | 'maybe' | 'no';

export const statusConfig: Record<RsvpStatusKey, RsvpStatusStyle> = {
  yes: {
    label: "You're going!",
    textColor: 'text-content-status-success',
    activeBg: 'bg-status-success-subtle',
    activeBorder: 'border-status-success',
    hoverBg: 'hover:bg-status-success-subtle',
    buttonText: 'Yes',
    sectionTitle: 'Going',
  },
  maybe: {
    label: "You're a maybe",
    textColor: 'text-content-status-warning',
    activeBg: 'bg-status-warning-subtle',
    activeBorder: 'border-status-warning',
    hoverBg: 'hover:bg-status-warning-subtle',
    buttonText: 'Maybe',
    sectionTitle: 'Maybe',
  },
  no: {
    label: "You're not going",
    textColor: 'text-content-secondary',
    activeBg: 'bg-surface-elevated',
    activeBorder: 'border-line-strong',
    hoverBg: 'hover:bg-status-error-subtle',
    buttonText: 'No',
    sectionTitle: "Can't Make It",
  },
};
