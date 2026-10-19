/* DECISION Phase 88.6.1-72 (owner ruling 2026-10-05; D-30): ONE source for the friend batch's
   terminal-409 rule and its two shipped lines, because the Friends page and the invite panel now
   show the same batch outcome. Chosen OVER exporting them from FriendInvitePanel.js (importing that
   module would pull qrcode.react and the dialog and Modal imports into the Friends route for two
   strings and a predicate) and OVER a second copy on the page (two copies of a shipped line drift
   apart, and the copy scan would find two sources for one sentence). D-30's placement rule is kept
   in spirit: the strings sit beside the two surfaces that show them, not in a central copy file.
   Changing this is a decision, not a cleanup.
   AMENDED Phase 88.6.1-90 (close ruling P-92, owner 2026-10-18): R2 and the all-failed line rule
   live here too, so the Friends page tells the same reason the panel does; both twin constants are
   gone. REJECTED: R2 on the page for mixed reasons (the two surfaces would disagree for one batch). */

import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

// Wave-12 review MED #9: fork-F contract — a terminal 409
// (already a member / invite pending) is not a FAILURE; count
// it separately instead of collapsing into failCount. Prose
// fallback removed post-88-34 deploy (2026-08-21, owner-ruled):
// the ERROR_REGISTRY codes are on the wire, so the code checks
// are the whole contract here — an unrecognized 409 stays in
// failCount rather than being silently counted "already".
export function isAlreadyInvitedOrMember(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'already_member' || code === 'invite_pending';
}

// The invite panel's two shipped lines (plan 88.6.1-27), moved here byte-for-byte; the dash in
// the mixed line is an EM DASH (U+2014), as shipped.
export const ALL_ALREADY_INVITED_MESSAGE = 'Everyone selected was already invited or a member';

export function invitedWithAlreadyMessage(successCount: number, alreadyCount: number): string {
  return `Invited ${successCount} — ${alreadyCount} already invited or a member`;
}

// D-32 R2 (ratified 2026-10-04; straight apostrophe, R8): an all-failed friend batch whose first failure has no code.
export const BATCH_INVITE_FAILED_MESSAGE = "We couldn't send those invites. Please try again.";

/**
 * The all-failed friend batch's line: the FIRST non-terminal failure's register line, or R2
 * (BATCH_INVITE_FAILED_MESSAGE) when that failure carries no code. This is DECISION Phase
 * 88.6-22's rule (kept in FriendInvitePanel.js), shared so the invite panel and the Friends page
 * say the same thing for the same batch (88.6.1-90, close ruling P-92).
 */
export function allFailedBatchLine(firstFailure: unknown): string {
  return getFetchErrorMessage(firstFailure, { fallback: BATCH_INVITE_FAILED_MESSAGE });
}
