'use client';

/**
 * UserChip — compact identity chip (PRIM-04 / D-03).
 *
 * Renders an avatar (or initials fallback) beside a display name, in the `cn()`
 * + `forwardRef` + `displayName` idiom with semantic tokens only. Adopted
 * downstream (Plan 07) by the invite/availability surfaces.
 *
 * Security (T-86-07): the avatar is rendered via a plain React `<img src>` — no
 * CSS `url()` sink — so a caller-supplied avatar URL cannot become a style
 * injection vector. The name renders as an auto-escaped React child.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

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
    const dim = size === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm';

    return (
      <div
        ref={ref}
        className={cn('inline-flex items-center gap-2', className)}
        {...props}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            className={cn('shrink-0 rounded-full object-cover', dim)}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-elevated font-semibold text-content-secondary',
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
