/**
 * hostGround — the typed key a control uses to name the ground its HOST paints, and the literal
 * halo class each ground resolves to.
 *
 * DECISION Phase 88.9-26 (R2-70, owner pick B1a, 88.9-PICKS-B1.json — H): a control's halo is the
 * ground its HOST paints, passed as a typed key and resolved through this literal map, chosen OVER
 * (P) the page halo everywhere (a 1.31 / 1.22 band on the 71 card paths) and OVER a free-form class
 * prop (a built or caller-typed class string emits no CSS under Tailwind v4). Every value is a
 * whole literal on purpose; composing one from parts is a decision, not a cleanup. Consumers:
 * FetchErrorBanner's small-notice Retry (R073); plans 88.9-30 and 88.9-35 add theirs.
 * AMENDED Phase 88.9-30 (owner picks B3a + B1a, 88.9-PICKS-B1.json, 2026-11-04): two keys join the
 * four — warning (the T box ground, status-warning-subtle) and group (the G host variable,
 * surface-group-halo) — so a control that can sit on any host family takes it through ONE typed
 * map, chosen OVER a second local map in ClickableMemberName.js (two maps drift). On the merits the
 * shared union is right; the record (plan 26's exactly-four-keys pin) was bookkeeping and is amended
 * in the same commit. Consumer added: ClickableMemberName (R012 / R013).
 */

/** The six grounds a host can paint under a control (the surface and status tokens in globals.css). */
export type HostGround = 'card' | 'page' | 'elevated' | 'muted' | 'warning' | 'group';

/** One whole `focus-visible:` halo literal per ground, so Tailwind's scanner emits each one. */
export const HOST_GROUND_HALO: Readonly<Record<HostGround, string>> = {
  card: 'focus-visible:ring-offset-surface-card',
  page: 'focus-visible:ring-offset-surface-page',
  elevated: 'focus-visible:ring-offset-surface-elevated',
  muted: 'focus-visible:ring-offset-surface-muted',
  warning: 'focus-visible:ring-offset-status-warning-subtle',
  group: 'focus-visible:ring-offset-surface-group-halo',
};

/** The halo class for a host ground; card when the host names none. */
export function hostGroundHalo(ground: HostGround = 'card'): string {
  return HOST_GROUND_HALO[ground];
}
