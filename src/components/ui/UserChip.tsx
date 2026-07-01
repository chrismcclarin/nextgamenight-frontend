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

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
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

export { UserChip };
