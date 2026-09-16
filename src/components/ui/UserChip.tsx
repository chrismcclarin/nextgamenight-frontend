'use client';

/**
 * UserChip — compact identity chip (PRIM-04 / D-03).
 *
 * Renders an avatar (or initials fallback) beside a display name, in the `cn()`
 * + `forwardRef` + `displayName` idiom with semantic tokens only. Adopted
 * downstream (Plan 07) by the invite/availability surfaces.
 *
 * Security (T-86-07, REWRITTEN Phase 88.6-37 / T-88.6-105): the avatar `src` goes
 * through the app's ONE shared protocol allow-list, `isAllowedImageUrl` — the same
 * list `safeBgImageStyle` uses for CSS `background-image` and `SafeImage` uses for
 * BGG thumbnails. A rejected URL renders the EXISTING initials branch below.
 *
 * WHAT THIS SENTENCE REPLACED, and why the replacement matters. It used to argue
 * that this sink is safe ON ITS OWN — "rendered via a plain React `<img src>` — no
 * CSS `url()` sink — so a caller-supplied avatar URL cannot become a style injection
 * vector". That is the per-sink reasoning `SafeImage.js:72-85`'s
 * `DECISION Phase CodeQL-hygiene` marker rejects in terms ("Deleting this check
 * because 'an img tag is safe anyway' re-splits the two sinks and is a decision, not
 * a cleanup"), and while it was TRUE it made `safeBgImageStyle.ts:3-7`'s stated
 * invariant — that the list is spelled ONCE so a scheme can never be permitted in one
 * surface and blocked in another — FALSE for this component. The reason this sink is
 * gated is the house rule, not a threat particular to this element.
 *
 * SCOPE, stated rather than overclaimed: this restores the one-list invariant for
 * THIS COMPONENT'S FAMILY. It does NOT hold across all of `src/` after Phase 88.6 —
 * `app/userProfile/page.js:1426` renders `<img src={user.picture}>` ungated, and is
 * routed by a `.planning/deferred/phase-88.6.md` entry. A header that overstates its
 * reach is the same defect as the one it replaces, pointing the other way.
 *
 * `referrerPolicy="no-referrer"` (D-22 / T-88.6-102) is on the `<img>` below; the
 * reason is recorded at that line. The name renders as an auto-escaped React child.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';
import { isAllowedImageUrl } from '@/lib/safeBgImageStyle';

/** Minimal user shape; tolerant of the app's varied user objects. */
export interface UserChipUser {
  name?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  picture?: string | null;
}

export interface UserChipProps extends React.HTMLAttributes<HTMLDivElement> {
  user: UserChipUser;
  size?: 'sm' | 'md';
}

const FALLBACK_LABEL = 'Unknown user';

/**
 * Initials for an avatar fallback / member chip.
 *
 * DECISION Phase 88.5 (D-10): a SINGLE-token label yields TWO characters
 * (`'boardgamer'` -> `'BO'`) rather than the one character this returned before —
 * chosen because most labels in this app are one-token usernames, where a lone `'B'`
 * reads as noise in a chip. Multi-token labels keep the first letter of the first two
 * tokens. The accepted consequence is that `UserChip`'s own avatar fallback (its one
 * existing render path) now shows two characters for single-token names too; that is
 * the change, not a side effect to undo.
 *
 * The `null`/`undefined` guard closes a crash path: a caller with neither a username
 * nor an email to pass in used to reach `.trim()` on a non-string.
 *
 * Exported (Phase 88.5) so `MemberChipStack` reuses it instead of forking it.
 */
function initialsOf(label: string | null | undefined): string {
  if (!label) return '?';
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    // D-10: two characters from the single token — `.slice(0, 2)` on a one-character
    // token yields that one character, never a padded value.
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const UserChip = React.forwardRef<HTMLDivElement, UserChipProps>(
  ({ user, size = 'md', className, ...props }, ref) => {
    const label = user.displayName || user.name || FALLBACK_LABEL;
    const avatar = user.avatarUrl || user.picture || null;
    /* DECISION Phase 88.6-37 (T-88.6-105): the avatar branch is gated on the SHARED
       `isAllowedImageUrl` imported from `@/lib/safeBgImageStyle` — chosen OVER a forked
       scheme check written here, and OVER leaving the sink ungated on the per-sink
       argument the old file header carried. Importing the shared one IS the invariant;
       a second copy is the failure mode `safeBgImageStyle.ts:3-7` exists to prevent.

       `allowRelative: true` mirrors `SafeImage.js:96` rather than `safeBgImageStyle`'s
       reject-relative default: an avatar may legitimately be a root-relative app-hosted
       path, and rejecting those would silently flip such a caller to the initials. It
       does NOT weaken the scheme check — an ABSOLUTE url ignores the base, so
       `javascript:` still fails the allow-list (`safeBgImageStyle.ts:23-34`).

       A rejected URL falls through to the EXISTING initials branch rather than rendering
       a dead `<img>`. Exploitability today is nil — `FriendInvitePanel.js:681-684` is the
       only importer and passes no avatar — so this is prospective hardening, which is
       exactly why the unit assertions per polarity are the control, not the caller. */
    const avatarOk = isAllowedImageUrl(avatar, { allowRelative: true });
    const dim = size === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm';

    return (
      <div
        ref={ref}
        className={cn('inline-flex items-center gap-2', className)}
        {...props}
      >
        {avatar && avatarOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            /* DECISION Phase 88.6-37 (D-22 / T-88.6-102): `no-referrer` chosen OVER
               leaving the element on the browser default. WHAT IT ACTUALLY BUYS, stated
               accurately because an earlier draft of the plan had it wrong: this repo
               sets NO `Referrer-Policy` (no `headers()` in `next.config.js`, no
               `vercel.json`, no `middleware.*`), so browsers apply their default
               `strict-origin-when-cross-origin`, which already withholds the PATH and
               QUERY from a cross-origin subresource request. There is no
               "group id or token-bearing path" leak today. What this attribute adds is
               suppressing even the ORIGIN, and hardening THIS element against a future
               site-wide policy weaker than the browser default. The structural control —
               a site-wide `headers()` security block — is Phase 90's (ruled 2026-09-14,
               because Phase 90 already opens `next.config.js`); it does not make this
               attribute redundant, and this attribute does not substitute for it.
               Removing it is a decision, not a cleanup. */
            referrerPolicy="no-referrer"
            className={cn('shrink-0 rounded-full object-cover', dim)}
          />
        ) : (
          <span
            aria-hidden="true"
            /* DECISION Phase 88.6-37 (D-03 / UI-SPEC §4.5 pill-ink row): the initials take
               `font-bold` (700), chosen OVER §4.5's other outcome for a 600 site —
               `font-normal` (400) plus a colour token. This is the TWIN of
               `MemberChipStack.tsx:85` (Phase 88.6-28, W36) and takes the same answer for
               the same geometric reason: this is 12px/14px ink on a COLOURED FILL at FIXED
               geometry (`h-6 w-6` / `h-8 w-8`), and the weight is what a two-letter glyph
               has instead of size. §4.5's 400 outcome is written for EMPHASIS SPANS on the
               page ground that take their distinction from a colour token — this ink is
               already spoken for (`text-content-secondary` on `bg-surface-elevated`), so
               there is no token left to give it.
               AND THE OTHER LEVER IS SPENT: D-01 rejected folding the 12px rung UP to 14
               for these fixed-geometry boxes, so the rung cannot move either. Visible
               delta 600 -> 700 on the initials fallback only, covered by V-6. */
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-elevated font-bold text-content-secondary',
              dim
            )}
          >
            {initialsOf(label)}
          </span>
        )}
        <span className="truncate text-sm text-content-primary">{label}</span>
      </div>
    );
  }
);

UserChip.displayName = 'UserChip';

export { UserChip, initialsOf };
