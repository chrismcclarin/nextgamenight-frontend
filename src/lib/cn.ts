import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names (clsx) and de-dupe conflicting Tailwind
 * utilities (tailwind-merge v2 — pinned to v2 because the project is on
 * Tailwind v3; tailwind-merge v3 targets Tailwind v4). This is the shadcn
 * `cn` util, hand-authored on the manual-install path (Pitfall 3 fallback).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
