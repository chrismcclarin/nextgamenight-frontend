/* DECISION Phase 88.6.1-72 (owner ruling 2026-10-05; D-30): ONE source for the friend batch's
   terminal-409 rule and its two shipped lines, because the Friends page and the invite panel now
   show the same batch outcome. Chosen OVER exporting them from FriendInvitePanel.js (importing that
   module would pull qrcode.react and the dialog and Modal imports into the Friends route for two
   strings and a predicate) and OVER a second copy on the page (two copies of a shipped line drift
   apart, and the copy scan would find two sources for one sentence). D-30's placement rule is kept
   in spirit: the strings sit beside the two surfaces that show them, not in a central copy file.
   Changing this is a decision, not a cleanup. */

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
