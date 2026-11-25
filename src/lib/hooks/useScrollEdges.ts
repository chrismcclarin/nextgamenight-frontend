'use client';

import type { RefObject } from 'react';

// RED stub (Phase 89.6-21 Task 4): the signature only, no behaviour yet.
export function useScrollEdges(ref: RefObject<HTMLElement | null>): { start: boolean; end: boolean } {
  void ref;
  return { start: false, end: false };
}
