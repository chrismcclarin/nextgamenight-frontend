'use client';

/**
 * RootAnnouncer — the one always-mounted sr-only polite region fed by the announcer store
 * (plan 88.9-24; owner ruling 88.9-RULINGS.md R-F1, 2026-11-08). Mounted once, in the root
 * layout beside the Toaster. The reasoning is the DECISION marker in ./announcer.ts.
 *
 * DialogAnnouncer (88.9-52, A-47) — the same region, inside an open house dialog. `Modal` and
 * `BottomSheet` each mount one as the last child of their dialog content. The reasoning is the
 * A-47 DECISION marker in ./announcer.ts.
 */
import * as React from 'react';

import {
  getHostSnapshot,
  getServerSnapshot,
  getSnapshot,
  registerAnnounceHost,
  releaseAnnounceHost,
  subscribe,
  type AnnounceHost,
} from './announcer';
import { StatusRegion } from './StatusRegion';

/* The ONE region both announcers render: a null host is the root's view of the store, a host is
   that dialog's view. `data-announcer` names which one a node is (root or dialog) for tests; it
   carries no behaviour. */
function AnnouncerRegion({ host }: { host: AnnounceHost | null }) {
  const text = React.useSyncExternalStore(
    subscribe,
    () => (host === null ? getSnapshot() : getHostSnapshot(host)),
    getServerSnapshot
  );
  return (
    <StatusRegion
      politeness="polite"
      className="sr-only"
      data-announcer={host === null ? 'root' : 'dialog'}
      message={text}
    />
  );
}

export function RootAnnouncer() {
  return <AnnouncerRegion host={null} />;
}

/**
 * The announcer region of one house dialog. Render it INSIDE the dialog content (inside the
 * aria-modal subtree) and pass the dialog's own `open` prop.
 *
 * - The region is mounted with the dialog content and is empty until the store hands it words,
 *   so it is a registered live region before any text arrives.
 * - The dialog is an announce target only while `open` is true. The host is dropped when `open`
 *   turns false, NOT when the content unmounts: Radix keeps the content mounted through the exit
 *   animation, and a closing dialog must not take words announced in the tick it closed
 *   (./announcer.ts, "THE TARGET IS FIXED WHEN THE WORDS LAND").
 * - The store is told separately when the content UNMOUNTS: until then the dialog is still on
 *   the page, and words wait for it to leave (./announcer.ts, "THE WORDS WAIT FOR A CLOSING
 *   DIALOG TO LEAVE THE PAGE"). The two effects below are declared in that order on purpose: on
 *   an outright unmount React runs the close first, then the release.
 * - Not focusable, no visible box (sr-only), no id: the dialog's focus trap and its
 *   aria-labelledby / aria-describedby wiring never see it.
 */
export function DialogAnnouncer({ open }: { open: boolean }) {
  // One identity for the life of this dialog instance; the store compares it by reference.
  const [host] = React.useState<AnnounceHost>(() => ({}));
  React.useEffect(() => {
    if (!open) return undefined;
    return registerAnnounceHost(host);
  }, [open, host]);
  React.useEffect(() => () => releaseAnnounceHost(host), [host]);
  return <AnnouncerRegion host={host} />;
}
