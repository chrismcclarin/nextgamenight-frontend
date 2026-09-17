'use client';
import { useState, useEffect, useRef, useId } from 'react';
import { invitesAPI } from '../../lib/api';
import { logger } from '@/lib/logger';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { useFriendshipStatus } from './FriendshipStatusProvider';
import { useUnreadNotificationCount } from './UnreadNotificationProvider';

function NotificationBell({ user, variant = 'icon', label }) {
  const [isOpen, setIsOpen] = useState(false);
  /* DECISION Phase 88.6-31 (ACCEPT §9 / #164, owner ruling 2026-09-14, option 1): both disclosure
     triggers gain `aria-expanded={isOpen}` and an `aria-controls` pointing at this id on the
     dropdown panel. This is the SINGLE two-attribute exception to plan 31's record-don't-fix a11y
     scope split, and nothing else in this file inherits it.

     REJECTED ARM: keep it ROUTED with the rest of the disclosure semantics (no Escape handler, no
     role on the panel, the `mousedown`-only outside-click) — those three ARE routed, to
     `.planning/deferred/phase-88.6.md` with a proposed owning phase.

     WHY THIS ONE WAS TAKEN. It is WCAG 4.1.2 (Name, Role, Value), Level A, on a trigger whose
     whole job is to announce a state it never exposed: before this commit the file carried
     exactly THREE `aria-` attributes in 409 lines (`grep -n 'aria-'`, measured 2026-09-16), and
     both triggers were `onClick={() => setIsOpen(!isOpen)}` with an `aria-label` and nothing
     else. BOTH, not one: the ROW variant is rendered inside the phone hamburger
     (`src/app/Header.js:287`), the phone-primary surface, which is why it was taken in scope at
     all. The change is ATTRIBUTE-ONLY — no handler change, no markup restructuring, no role added
     to the panel, no visible behaviour — and that smallness is the argument that won the
     exception. The boundary it is an exception TO is a real CONSEQUENCE constraint, stated here
     so it survives the next reader: a wave-7 sweep plan that starts fixing a11y defects loses its
     boundary. Neither trigger's prior-decision comment (the `surfaceHoverSweep` hover pin on the
     row, the Phase 88.3 focus-ring treatment on the icon) constrains ARIA attributes — confirmed
     at both sites before editing, not assumed. */
  const panelId = `${useId()}-notification-panel`;
  const [actionLoading, setActionLoading] = useState(null);
  // { text, tone: 'success' | 'muted' } — muted is the L-8 "no longer
  // available" notice, which must not render in success-green.
  const [confirmation, setConfirmation] = useState(null);
  const dropdownRef = useRef(null);

  // MOB-08 (Plan 77-01): invites + friendRequests now live in
  // UnreadNotificationProvider so the in-menu badge AND the mobile hamburger
  // dot read the exact same totalCount — including optimistic updates after
  // Accept/Decline (which go through ctxSetInvites below).
  const {
    invites,
    friendRequests,
    totalCount,
    loading,
    setInvites: ctxSetInvites,
  } = useUnreadNotificationCount();

  // Friend accept/decline still go through FriendshipStatusProvider — that
  // provider owns the friend-request state and its optimistic mutators.
  const {
    acceptRequest: ctxAcceptFriend,
    declineRequest: ctxDeclineFriend,
  } = useFriendshipStatus();

  // Click-outside detection to close dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear confirmation after 3 seconds
  useEffect(() => {
    if (!confirmation) return;
    const timer = setTimeout(() => setConfirmation(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmation]);

  /* DECISION Phase 88.6-31 (AC-16 option (a) + AC-2 WIDENED, owner rulings 2026-09-09): all four
     accept/decline failure paths below were raw `console.error` calls forwarding `err.message`,
     with no toast,
     no inline message and NO Sentry capture — a failed Accept left the row in place and the user
     reasonably concluded it worked. They are now `logger.error('<msg>', err)`, the message string
     kept VERBATIM, and THAT CALL IS THE ESCALATION the ruling asked for: `logger.error` routes to
     `Sentry.captureException` (`logger.ts:28-30`), so a failed accept/decline now files a real
     Sentry EVENT where before it was at most a console breadcrumb (there is no
     `captureConsoleIntegration` in `sentry.client.config.js`, and `QueryCache.onError` covers only
     query-cache errors). A console-only diagnostic is no longer an acceptable end state here.
     No hand-rolled `Sentry.captureException` goes in beside these — one escalation per failure
     path. Unlike the two feedback writers (this plan's tasks 1 and 2), these four carry no TAG
     requirement, which is exactly what makes `logger.error` — a call with no tags channel — the
     right mechanism HERE and the wrong one THERE.

     THE SECOND ARGUMENT IS THE ERROR OBJECT, not the bare `err.message` string these sites used
     to forward. `logger.error` synthesizes `new Error(msg)` only when `err` is OMITTED, so passing
     the object is what `logger.ts`'s T-84-01 contract describes — the caller message plus the
     error itself — and is strictly more useful in Sentry than a stringified message. What T-84-01
     forbids is unchanged and is honoured: no request-body field, no member/user record, no email,
     no token, no URL. (The inverse instruction in this phase's other converting plans — name and
     message in a ctx object, never the raw Error — follows from `logger.info(msg, ctx)`'s
     signature and does NOT apply here, because these four are `logger.error`.)

     LEVEL: these four stay at `logger.error` rather than taking AC-2's 2026-09-13 amended default
     of `logger.info`. The ruling's five-name enumeration is BOOKKEEPING — violating it costs one
     line in `RULINGS.md`, and that amendment is written (round-6 amendment section, note A);
     AC-16 (a)'s DELIVERY is CONSEQUENCE. `logger.info` is `Sentry.addBreadcrumb` and files nothing
     on its own, so demoting them would un-deliver the ruling and leave `T-88.6-84` (severity high)
     asserting a mitigation it no longer has.

     IN PLACE, and that word is load-bearing. `handleAccept`'s and `handleDecline`'s calls sit
     inside the **`else`** of an `if (err?.status === 410)` guard, and the 410 arm is a DESIGNED
     OUTCOME, not a failure — the group was soft-deleted under the invite, the row is dropped and a
     muted notice shown (accept) or nothing is said (decline, because removal is what the user
     asked for). Hoisting a converted call to the top of either catch would file a Sentry event on
     every soft-deleted invite, escalating an outcome the user sees as success. The other two are
     bare catches with no branch. CONVERT-ON-TOUCH EXECUTION CHECK, run before converting rather
     than after: all four sites are `catch` arms of async handlers, so all four convert IN PLACE
     and NONE needed moving into a guarded effect or behind a latch — no render body, no per-item
     loop, so neither the event-volume argument nor the finite-breadcrumb-buffer argument binds.

     DISCLOSED BEHAVIOUR DELTA, not a discovered one: each of these four now produces a Sentry
     event, and because `sentry.client.config.js` sets a non-zero `replaysOnErrorSampleRate` the
     first such event in a buffering session can flush the Session Replay buffer and convert that
     session to continuous recording and upload for its remainder. That cost is BOUNDED by plan
     13's D2 sampling gate, which landed in wave 3 ahead of this plan.

     RECORDED SUPERSEDED ARM, kept rather than deleted: round 3 specified a hand-rolled CLASS-ONLY
     `Sentry.captureException` at each of the four, in `FeedbackForm.js`'s shape. AC-2 WIDENED
     replaced the MECHANISM, not the outcome; AC-16's word "class-only" was amended to "a Sentry
     capture" (owner, 2026-09-13, D7 arm A). A literal class-only wrapper was rejected because it
     would produce an almost content-free event here — worse diagnostics than the ruling existed to
     restore — and because the class-only shape exists for a body carrying a reporter's address and
     prose, which an accept/decline does not have. RESIDUAL, accepted by the owner 2026-09-13:
     non-pattern upstream prose (group names, provider prose) reaching Sentry from these paths;
     pattern PII is redacted by `sentry.scrub.js`'s `beforeSend`. */
  async function handleAccept(invite) {
    setActionLoading(invite.id);
    try {
      await invitesAPI.acceptInvite(invite.id);
      // Optimistic update via the shared context — drops totalCount
      // immediately for BOTH the bell badge and the mobile hamburger dot.
      ctxSetInvites((prev) => prev.filter((i) => i.id !== invite.id));
      const groupName = invite.Group?.name || invite.group_name || 'the group';
      setConfirmation({ text: `Joined ${groupName}!`, tone: 'success' });
      // GROUP-08: signal the home page to refresh its groups list. sessionStorage
      // covers a later navigation; window event covers the in-place case where the
      // user is already on / when they click Accept in the bell.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('nggroups:refresh', '1');
        window.dispatchEvent(new CustomEvent('nggroups:refresh'));
      }
    } catch (err) {
      // L-8: 410 = the group was soft-deleted under this invite (88.2 liveness
      // gate). The row is dead — drop it now instead of leaving a button that
      // visibly does nothing until the next refetch INNER-JOINs it out.
      if (err?.status === 410) {
        ctxSetInvites((prev) => prev.filter((i) => i.id !== invite.id));
        const groupName = invite.Group?.name || invite.group_name || 'This group';
        setConfirmation({ text: `${groupName} is no longer available.`, tone: 'muted' });
      } else {
        logger.error('Failed to accept invite:', err);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDecline(invite) {
    setActionLoading(invite.id);
    try {
      await invitesAPI.declineInvite(invite.id);
      ctxSetInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      // L-8: dead-group 410 — removing the row is exactly what the user asked
      // for, so no notice needed.
      if (err?.status === 410) {
        ctxSetInvites((prev) => prev.filter((i) => i.id !== invite.id));
      } else {
        logger.error('Failed to decline invite:', err);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAcceptFriend(request) {
    setActionLoading(request.id);
    try {
      // Provider handles optimistic removal + 404-stale silencing.
      // alreadyAccepted means the row was already resolved on another
      // surface (friends page) — we still show the success confirmation
      // since from the user's POV the action they wanted is done.
      await ctxAcceptFriend(request.id);
      setConfirmation({ text: 'Accepted friend request!', tone: 'success' });
    } catch (err) {
      logger.error('Failed to accept friend request:', err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeclineFriend(request) {
    setActionLoading(request.id);
    try {
      await ctxDeclineFriend(request.id);
    } catch (err) {
      logger.error('Failed to decline friend request:', err);
    } finally {
      setActionLoading(null);
    }
  }

  if (!user) return null;

  // Bell SVG — shared between icon and row variants. Decorative inside row variant
  // (the surrounding button is the actual hit target per CONTEXT D-02 "bell + row
  // are one combined target; bell becomes purely decorative").
  const bellIcon = (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );

  const countBadge = totalCount > 0 ? (
    <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center">
      {totalCount > 9 ? '9+' : totalCount}
    </span>
  ) : null;

  return (
    <div className="relative" ref={dropdownRef}>
      {variant === 'row' ? (
        // Full-width row hit area — entire surface is one tap target;
        // text-left so the label aligns with surrounding rows.
        // DECISION Phase 87.8 (D-12): pressed state is now an instant opacity dim.
        // DECISION Phase 87.8 — this supersedes the CONTEXT D-02 token-swap idiom (active:bg-surface-card-hover)
        // previously recorded here: --theme-transition (globals.css:569) transitions
        // background-color at 0.25s and does not list opacity, so a background swap
        // is swallowed on an ~80ms tap while an untransitioned opacity change fires
        // instantly. hover:bg-surface-card-hover stays — correct on desktop, inert
        // on touch (Tailwind v4 hover media query), and inertness is not a defect.
        // ——— AMENDED Phase 88.3 (§10.1), original reasoning above KEPT AS HISTORY:
        // the PRESS IDIOM half still stands verbatim — the press is an opacity dim, and
        // a desktop-only hover being inert on touch is still not a defect. What changed
        // is the COLOUR FAMILY of that hover, and only because plan 88.3-03 re-keyed
        // --color-bg-card-hover: the sentence "hover:bg-surface-card-hover stays" was
        // true when the card-hover token was a near-white wash and became false the
        // moment it became warm-200. See the marker below.
        // ——— AMENDED Phase 88.6-02 (D-15): the token named `--color-bg-card-hover` /
        // `bg-surface-card-hover` throughout the two paragraphs above is now
        // `--color-bg-muted` / `bg-surface-muted`, at byte-equal values. The old spelling is
        // KEPT quoted above because those sentences record what was true THEN; nothing about
        // the 87.8 press-idiom reasoning or the 88.3 colour-family move changes.
        //
        // DECISION Phase 88.3 (§10.1): this row hovers to `bg-surface-header-hover`
        // (warm-700), chosen OVER `bg-surface-hover` (warm-50) which the other 38 swept
        // sites took. Ground reason: this row renders inside the mobile menu panel on
        // `bg-surface-header` (Header.js:192) under `text-white` — a warm-50 wash there
        // measures 1.06:1, while warm-700 measures 10.48:1. The nav links beside it
        // (Header.js:204, :212) were already on the header family and are the model this
        // row should have followed; it had drifted onto the card family.
        // ThemeToggle.js:32 and FeedbackButton.js:84 are the same row idiom on the same
        // panel and moved with it — all three are cross-referenced back to this marker.
        // Converging these three onto `bg-surface-hover` "for consistency" with the other
        // 38 re-introduces a 1.06:1 hover state; `surfaceHoverSweep.test.ts` test 4b pins
        // all three by name so that goes red. That is a decision, not a cleanup.
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-header-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
          aria-label={label ? `${label} notifications` : 'Notifications'}
          // Phase 88.6-31, the named two-attribute exception — see the marker at `panelId`.
          aria-expanded={isOpen}
          aria-controls={panelId}
        >
          {bellIcon}
          {/* DECISION Phase 88.3 (Req 8 / UI-SPEC §5.9.2): this label DROPS
              `text-content-muted` and inherits the row button's `text-white` — chosen OVER
              scoping a lighter muted value to the header subtree.

              MEASURED BASIS: this row sits on the dark header panel (`--color-bg-header`,
              warm-800 in light mode). Muted was never right for that ground — warm-500
              (today) reads 3.66:1, already failing — and Req 8's move to warm-550 makes it
              measurably WORSE at 2.79:1 (warm-600 would be 2.28:1). Inheriting the row's own
              `text-white` reads 15.03:1. Dark mode is byte-identical: the row is `text-white`
              there too, so nothing changes.

              AMENDED Phase 88.3-18 (owner ruling 1c, 2026-08-28) — above KEPT AS HISTORY. The
              parenthetical became the shipped value: `--warm-550` is RETIRED and the LIVE muted
              is **warm-600 at 2.2848:1** on this warm-800 ground. (Ruling 1c moved the page to
              warm-200, where warm-550 measured 4.1460 — below Req 8's own 4.5 floor — so muted
              had to move.) THE DECISION IS UNCHANGED AND ONLY GETS STRONGER: drop
              `text-content-muted`, inherit the row's `text-white` (15.03:1). 2.2848 is FURTHER
              below the floor than the 2.79 this marker was written against, so read the number
              change as reinforcement, not as the decision moving.

              REJECTED — minting a header-scoped lighter muted value. That would create a
              FOURTH meaning of "muted" for the sake of three labels, when the correct fix is
              to remove a token that was wrong for this ground in the first place.

              This applies to all three header-row labels: `ThemeToggle.js`'s and
              `FeedbackButton.js`'s carry a one-line pointer back here. Every OTHER
              `text-content-muted` in these three files sits on a card or dropdown-panel
              ground (confirmed site by site) and is correct — `darkChromeLegibility.test.ts`
              test 3 is deliberately narrowed to the `text-content-muted flex-1` shape so it
              cannot demand those be removed too.

              Putting a muted token back on this label is a decision, not a cleanup. */}
          <span className="flex-1">{label || 'Notifications'}</span>
          {countBadge}
        </button>
      ) : (
        // Icon-only trigger — desktop nav. Visual unchanged from pre-Plan-68-01.
        <button
          onClick={() => setIsOpen(!isOpen)}
          // Phase 88.3 (Req 7 / UI-SPEC §5.8.2): this icon-only trigger shipped with NO
          // focus-visible ring at all — unlike the row variant above — and fell to the UA
          // outline on the warm-800 header. It now carries the same treatment as the row
          // variant, and inherits the amber-400 `--ring` override scoped to the header
          // subtree at `Header.js`'s container. See the DECISION marker on the row label below.
          className="relative text-white hover:text-amber-400 transition-colors p-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
          aria-label="Notifications"
          // Phase 88.6-31, the named two-attribute exception — see the marker at `panelId`.
          aria-expanded={isOpen}
          aria-controls={panelId}
        >
          {bellIcon}

          {/* Red badge with count — absolute-positioned over the bell */}
          {totalCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {totalCount > 9 ? '9+' : totalCount}
            </span>
          )}
        </button>
      )}

      {/* Dropdown panel — positioning differs by variant:
          - row variant (mobile hamburger): render inline so the panel expands
            within the menu naturally (no fixed/absolute escape from flow).
          - icon variant (desktop nav): fixed/absolute overlay near the bell. */}
      {isOpen && (
        <div
          id={panelId}
          className={
            variant === 'row'
              ? "bg-surface-card border-t border-line-header"
              : "fixed right-2 left-2 sm:left-auto sm:absolute sm:right-0 mt-2 sm:w-80 bg-surface-card rounded-lg shadow-theme-lg border border-line z-50"
          }
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-line">
            {/* §4.4: an h3 at 14 STAYS at 14 (its table's "h3 @ 14 and h3 @ 16 -> stay" row), so
                `size="label"` STATES the rung rather than inheriting the primitive's level-derived
                default. LEVEL PRESERVED (P4) — `typeScaleTouchedSurfaces`' EXPECTED_LEVELS entry
                for this file (`{ 3: 1 }`) is byte-unchanged; only the SOURCE of the rung and the
                weight moves, and `font-bold` was already what this site shipped. */}
            <Heading level={3} size="label" className="text-content-primary">
              Notifications
            </Heading>
          </div>

          {/* Confirmation banner — success-green for completed actions, muted
              for the L-8 "no longer available" notice */}
          {confirmation && (
            <div className={`px-4 py-2 border-b border-line ${
              confirmation.tone === 'success' ? 'bg-status-success-subtle' : 'bg-surface-muted'
            }`}>
              {/* DECISION Phase 88.6-31 (D-16, owner ruling ARM A, 2026-09-16): the MUTED arm's
                  ink moves `text-content-muted` (4.3725) -> `text-content-secondary` (6.9620),
                  chosen OVER leaving it and OVER changing the GROUND. This is a measured sub-AA
                  pairing, not a scan artefact: both arms key on the SAME condition
                  (`confirmation.tone === 'success'`), so the muted ink and the muted
                  `bg-surface-muted` ground directly above are genuinely co-live. The token was
                  wrong for this ground, not the ground — this is a NOTICE, and `secondary` is the
                  shape plan 27 chose for the same class of site. The SUCCESS arm is
                  byte-unchanged. Its `groundInk.test.ts` OFFENDERS entry is deleted in this same
                  commit, as that roster's exactness requires.
                  §4.5: `font-medium` takes the EMPHASIS outcome — DELETED, with the distinction
                  carried by the colour token each arm already has (dropped-utility spelling, the
                  same one this plan's tasks 1 and 2 used). */}
              <p className={`text-sm ${
                confirmation.tone === 'success' ? 'text-content-status-success' : 'text-content-secondary'
              }`}>{confirmation.text}</p>
            </div>
          )}

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center">
                <div className="inline-block w-5 h-5 border-2 border-line border-t-accent rounded-full animate-spin" />
              </div>
            ) : totalCount === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-content-muted">No pending notifications</p>
              </div>
            ) : (
              <>
                {/* Group Invites section */}
                {invites.length > 0 && (
                  <>
                    <p className="text-xs font-bold text-content-muted uppercase tracking-wider px-4 pt-3 pb-1">
                      Group Invites
                    </p>
                    <ul>
                      {invites.map((invite) => {
                        const groupName = invite.Group?.name || invite.group_name || 'Unknown Group';
                        const inviterName = invite.Inviter?.username || invite.inviter_name || 'Someone';
                        const memberCount = invite.Group?.memberCount || invite.member_count || null;
                        const isLoading = actionLoading === invite.id;

                        return (
                          <li
                            key={invite.id}
                            className="px-4 py-3 border-b border-line last:border-b-0"
                          >
                            <p className="text-sm font-bold text-content-primary">{groupName}</p>
                            <p className="text-xs text-content-muted mt-0.5">
                              {inviterName} invited you
                            </p>
                            {memberCount && (
                              <p className="text-xs text-content-muted mt-0.5">
                                {memberCount} member{memberCount !== 1 ? 's' : ''}
                              </p>
                            )}

                            <div className="flex gap-2 mt-2">
                              <Button
                                variant="primary"
                                onClick={() => handleAccept(invite)}
                                disabled={isLoading}
                                className="flex-1"
                              >
                                {isLoading ? (
                                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  'Accept'
                                )}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => handleDecline(invite)}
                                disabled={isLoading}
                                className="flex-1"
                              >
                                Decline
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                {/* Friend Requests section */}
                {friendRequests.length > 0 && (
                  <>
                    <p className="text-xs font-bold text-content-muted uppercase tracking-wider px-4 pt-3 pb-1">
                      Friend Requests
                    </p>
                    <ul>
                      {friendRequests.map((request) => {
                        const requesterName = request.Requester?.username || 'Someone';
                        const isLoading = actionLoading === request.id;

                        return (
                          <li
                            key={request.id}
                            className="px-4 py-3 border-b border-line last:border-b-0"
                          >
                            <p className="text-sm font-bold text-content-primary">{requesterName}</p>
                            <p className="text-xs text-content-muted mt-0.5">
                              wants to be your friend
                            </p>

                            <div className="flex gap-2 mt-2">
                              <Button
                                variant="primary"
                                onClick={() => handleAcceptFriend(request)}
                                disabled={isLoading}
                                className="flex-1"
                              >
                                {isLoading ? (
                                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  'Accept'
                                )}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => handleDeclineFriend(request)}
                                disabled={isLoading}
                                className="flex-1"
                              >
                                Decline
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
