'use client';

/**
 * RootAnnouncer — the one always-mounted sr-only polite region fed by the announcer store
 * (plan 88.9-24; owner ruling 88.9-RULINGS.md R-F1, 2026-11-08). Mounted once, in the root
 * layout beside the Toaster. The reasoning is the DECISION marker in ./announcer.ts.
 */
import * as React from 'react';

import { getServerSnapshot, getSnapshot, subscribe } from './announcer';
import { StatusRegion } from './StatusRegion';

export function RootAnnouncer() {
  const text = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <StatusRegion politeness="polite" className="sr-only" message={text} />;
}
