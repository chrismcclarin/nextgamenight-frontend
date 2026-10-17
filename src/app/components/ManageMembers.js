'use client';
import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, invitesAPI, API_BASE_URL } from '../../lib/api';
import ClickableMemberName from './ClickableMemberName';
import KebabMenu from './KebabMenu';
import FriendInvitePanel from './FriendInvitePanel';
import { toast } from 'sonner';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner, RefreshFailedNotice, RetainedContentFocusGuard, useRetainedContent } from '../../components/ui/FetchErrorBanner';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { logger, errCtx } from '../../lib/logger';
import { Modal } from './Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { SelectControl } from '../../components/ui/Input';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';

// Copy row G1 (Phase 88.6.1 D-30, owner-ratified 2026-10-04): the opener says what its dialog title and its receipt say.
const RESET_INVITE_LINK_LABEL = 'Reset invite link';

// The outcome plan 21's `classifyRetryResult` reads from a retry's own result (plan 55's names and shape).
const LOAD_OK = Object.freeze({ isError: false });
const LOAD_FAILED = Object.freeze({ isError: true });

function ManageMembers({ group_id, user, modal, modaltoggle, onMembersUpdated, group_name }) {
    const router = useRouter();
    // Phase 87.3-05 (PR-B): resolve the caller's own Users.id UUID once via the
    // shared identity primitive. The self-badge, current-member role derive, and
    // every group-admin mutation target key on the nested member.id (UUID) — not
    // the flat member.user_id vs sub compare (which flips value at PR-C). selfUuid resolves
    // ASYNC (D-04), so the current-member role derive re-runs when it resolves.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    // The group whose roster is on screen (D-09a): the has-loaded flag is this id compared with
    // `group_id`, never `members.length` — a roster that loaded empty and one never loaded differ.
    const [loadedGroupId, setLoadedGroupId] = useState(null);
    const hasLoaded = loadedGroupId === group_id;
    // W027: bumped at the start of every fetchMembers call; a run that is no longer the latest
    // writes nothing after its awaits (see the W027 marker above fetchMembers).
    const fetchGenerationRef = useRef(0);
    // Mirrors `rosterWithheld` (loaded, but withheld by `useRetainedContent`) after each commit;
    // the close reset reads it (see the C10 marker below the members error adapter).
    const rosterWithheldRef = useRef(false);
    // The group the latest fetch asked for: a fetch for another group resets the previous
    // group's error, pending invites and role, and the banner shows an error only for this key.
    const [requestedGroupId, setRequestedGroupId] = useState(null);
    /* DECISION Phase 88.6.1-42 (D-04, D-05, H1-H3): the three handlers whose refresh can remove
       the row the user is on (the remove, the approve, the reject) arm the ONE shared hook
       (plan 88.6.1-04) before any await and settle it in `finally`. A phone remove lands on the
       neighbour row's member-actions trigger (the next row, else the previous one, captured at
       arm time; a natively disabled trigger is skipped, an `aria-disabled` one is not, because
       it can still take focus), and with no such neighbour on this dialog's title (the section
       heading), reached through the hook's floor because this host sits inside a `Modal`.
       Approve and reject land on the title.
       REJECTED, each with its reason:
       (a) a ref into the Modal header: `ModalHeader` takes no ref, so it would be an edit to the
           shared primitive for the same element the floor already finds.
       (b) always the title: D-05 as first written ("whole-list remounts -> the section heading")
           assumed the whole roster remounted. After D-09a rows are keyed on the member id and
           survive, so a single-row removal has a neighbour, and the title throws away the
           user's place in a list they may be working through. D-05 is amended to "single-row
           removal -> the neighbour row, else the heading" (D-57), the same reading plan
           88.6.1-41 records for the home group list.
       (c) arming the role change: after D-09a it removes nothing. Its refresh may MOVE the row
           (the members GET has no order), and the shared hook cannot tell a moved node from a
           blank-area click. No host-local re-focus is built either: MEASURED (T8b), React DOM's
           commit re-focuses a moved node that held focus before the commit (`restoreSelection`,
           the finding plan 88.6.1-41 recorded), so a re-focus written here could never act.
       (d) a fallback prop on KebabMenu: its own marker, and D-04.
       (e) the row's first control in DOM order: at phone width the desktop controls are hidden
           and cannot take focus.
       The dialog-tier remove and reject close their ConfirmDialog after the refresh, and the
       hook defers to the primitive's restore, which floors to this title (D-07, plan 88.6.1-20;
       `DECISION Phase 88.6-44`). Approve and reject go with Phase 91.1. Changing this is a
       decision, not a cleanup. */
    const rosterFocusRecovery = useFocusRecovery();
    // The phone member-actions wrapper of each active row, by member id (callback refs below).
    const memberActionsNodesRef = useRef(new Map());
    // The arm-time neighbour resolver for a remove: the member-actions trigger of the active row
    // directly after, else directly before, the removed one; null when neither has a usable one.
    const neighbourMemberActions = (target_user_id) => {
        const active = members.filter((m) => m.UserGroup?.role !== 'pending');
        const index = active.findIndex((m) => m.id === target_user_id);
        const neighbours = index === -1
            ? []
            : [active[index + 1], active[index - 1]].map(
                (m) => (m ? memberActionsNodesRef.current.get(m.id) : undefined)
            );
        return () => {
            for (const wrapper of neighbours) {
                const trigger = wrapper?.querySelector('button');
                if (trigger && trigger.isConnected && !trigger.hasAttribute('disabled')) return trigger;
            }
            return null;
        };
    };
    const [userRole, setUserRole] = useState(null);
    /* DECISION Phase 88.6-19 (R1 / UI-SPEC §6.2 arm 1): the members LOAD failure holds the
       ERROR OBJECT, not a flattened "Failed to load members" string, and renders through the
       shared `useFetchErrorState` + `<FetchErrorBanner>` pair — chosen OVER keeping the bare
       `<p className="text-red-600">{error}</p>` line it replaced.

       WHY. §6.2's first row routes a load failure of a surface's primary data to the banner,
       and the string being retired is one of the eight ad-hoc "Failed to X" copies P1 forbids
       authoring. Keeping the ERROR (the 88-14 idiom, `friends/page.js`'s
       `setFriendsLoadError(` error object / `GroupLibrary.js`) is what lets `useFetchErrorState` read `ApiError.code` and pick the
       ratified copy, including the 403 line — a flattened string cannot be re-classified.

       Collapsing this back to a string, or back to a bare red `<p>`, is a decision: it
       re-authors copy outside the register AND drops the banner's retry and its live region. */
    const [error, setError] = useState(null);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [pendingLoading, setPendingLoading] = useState(false);
    // Phase 69-02 GROUP-06: per-row Transfer Ownership confirm modal target.
    // Owner-only kebab on each non-owner active row sets this; null = closed.
    const [transferTarget, setTransferTarget] = useState(null); // { id (member UUID), name } or null
    const [transferring, setTransferring] = useState(false);
    // The pressed Transfer ownership's latch: see DECISION Phase 88.6.1-50 at the transfer footer.
    const transferInFlightRef = useRef(false);
    // Invite modal + reset-link state — buttons live in the Manage Members header,
    // the actual invite UI is the existing FriendInvitePanel modal.
    const [inviteModalOpen, setInviteModalOpen] = useState(false);
    const [resettingInvite, setResettingInvite] = useState(false);
    // Phase 69-04 mirror: same confirm-modal Leave flow as GroupSettings,
    // so the in-row "Leave Group" button (non-owner self-row) gets the
    // canonical copy + inline error UX rather than window.confirm.
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
    const [leaving, setLeaving] = useState(false);
    // The pressed Confirm Leave's latch: see DECISION Phase 88.6.1-50 at the transfer footer.
    const leaveInFlightRef = useRef(false);
    const [leaveError, setLeaveError] = useState('');
    // Stable id for the leave-confirm failure's live region, so the Confirm control can
    // name it with `aria-describedby`. `useId` and not a literal: this component can be
    // mounted more than once in a tree and a duplicate id would make the reference
    // ambiguous.
    const leaveErrorId = useId();
    // Phase 88-12 (Req 11): the gates below are tiered via useConfirmAction, whose
    // config is re-read every render — so the TARGET each dialog is talking about
    // lives here, and the title interpolates from it. `{ id, name }` for remove and
    // reject; the promote target additionally carries `priorRole` (see the select
    // marker below for why).
    const [removeTarget, setRemoveTarget] = useState(null);
    const [rejectTarget, setRejectTarget] = useState(null);
    const [promoteTarget, setPromoteTarget] = useState(null);

    useEffect(() => {
        if (modal && group_id && user?.sub) {
            fetchMembers();
        }
        // selfUuid is in the deps so that when identity resolves on a cold
        // cache, fetchMembers re-runs and the current-member role derive (which
        // gates the pending-invites fetch + admin controls) recomputes against
        // the resolved UUID instead of sticking at a wrong "no role".
    }, [modal, group_id, user?.sub, selfUuid]);

    // The close reset (R8 empty at a dialog host; C10 memory): see DECISION Phase 88.6.1-78
    // (C10 access or gone, close reset) below the members error adapter. A run still in flight
    // writes nothing; a transient error is cleared so a reopen mounts the notice's region empty;
    // a withheld roster keeps its error. The roster itself is untouched (D-09a).
    useEffect(() => {
        if (modal) return;
        fetchGenerationRef.current += 1;
        if (!rosterWithheldRef.current) setError(null);
    }, [modal]);

    /* DECISION Phase 88.6.1-42 (W027 / IN-208): a generation counter (`fetchGenerationRef`)
       bumped at CALL START and checked after every await (the members GET, the pending-invites
       GET, the catch, each finally), so a superseded run writes nothing. It is the house idiom of
       `QuickSuggestions.js` (`generationRef`), moved from an effect cleanup to the call start.
       REJECTED: (a) IN-208's `isCancelled` closure passed from the effect (the `EventCalendar.js`
       88.6-27 shape), because four of the five refresh callers are handlers with no effect cleanup
       to invalidate them, so a remove refresh and an identity refresh could still land out of
       order; (b) `AbortController`, rejected by name in 88.6-27.
       ALSO CHOSEN, each over a named alternative:
       - the error is cleared on SUCCESS, not at fetch start, CHOSEN OVER clearing it up front:
         that unmounts the banner and its focused Try again the moment a retry starts;
       - the error is RESET when a fetch asks for a different group than the latest one did
         (`requestedGroupId`), together with the previous group's pending invites and the
         caller's role, and the banner shows an error only for that group, CHOSEN OVER clearing
         it on success alone (a previous group's failure would hold the new group's first-load
         place, banner and all, until a success) and over a reset in the effect alone (the commit
         that changes the group would still mount the previous group's banner and its live
         region);
       - the invite and role reset runs on a group change ONLY, CHOSEN OVER every refresh (the
         title would flip to the plain members title for the length of each refresh);
       - a payload that is not an array is a FAILURE, CHOSEN OVER writing an empty roster: that
         printed the empty sentence for a request that returned no roster (Req 9, SPEC
         Prohibition 2). Its breadcrumb below is byte-unchanged.
       Changing any of this is a decision, not a cleanup. */
    const fetchMembers = async () => {
        if (!modal || !group_id || !user?.sub) return;
        const generation = ++fetchGenerationRef.current;
        const isCurrent = () => generation === fetchGenerationRef.current;
        if (requestedGroupId !== group_id) {
            setRequestedGroupId(group_id);
            setError(null);
            setPendingInvites([]);
            setUserRole(null);
        }
        setLoading(true);
        try {
            // Use groupsAPI.getGroupMembers which automatically includes Authorization header
            const data = await groupsAPI.getGroupMembers(group_id);
            if (!isCurrent()) return;

            // Ensure data is an array before processing
            /* DECISION Phase 88.6-19 (AC-2 / T-84-01): this report's second argument is a SHAPE
               DESCRIPTOR, not the upstream payload it used to carry. The raw call passed `data`
               straight through, which is exactly the response body `logger.ts:8-13` forbids
               reaching Sentry. The level is `info` (a breadcrumb) and not `warn`, because
               `logger.warn` is `Sentry.captureMessage` — an EVENT, the arm the owner rejected on
               2026-09-13. Restoring either the payload or the `warn` level is a decision. */
            if (!Array.isArray(data)) {
                logger.info('Members data is not an array:', {
                    received: data === null ? 'null' : typeof data,
                });
                setError(new Error("The members request didn't complete."));
                return LOAD_FAILED;
            }

            setMembers(data || []);
            setLoadedGroupId(group_id);
            setError(null);

            // Find current user's role by the nested member.id (UUID) vs the
            // resolved selfUuid. Gated on identity resolution: while selfUuid is
            // undefined we skip the derive (loading), never store a wrong "no
            // role" — the effect re-runs when identity resolves (selfUuid in deps).
            if (!selfUuid) {
                setPendingInvites([]);
                return LOAD_OK;
            }
            const currentUserMember = data.find(m => m.id === selfUuid);
            const role = currentUserMember?.UserGroup?.role || null;
            if (role) setUserRole(role);

            // Pending invites endpoint is owner/admin-only — gate the call so non-admins
            // don't trigger a 403 + console error every time they open the modal.
            if (role === 'owner' || role === 'admin') {
                try {
                    setPendingLoading(true);
                    const invites = await invitesAPI.getGroupPendingInvites(group_id);
                    if (!isCurrent()) return;
                    setPendingInvites(Array.isArray(invites) ? invites : []);
                } catch (inviteErr) {
                    if (!isCurrent()) return;
                    setPendingInvites([]);
                } finally {
                    if (isCurrent()) setPendingLoading(false);
                }
            } else {
                setPendingInvites([]);
            }
            // The roster loaded; a failed pending-invites read above is swallowed and still OK.
            return LOAD_OK;
        } catch (error) {
            logger.info('Error fetching members:', errCtx(error));
            if (!isCurrent()) return;
            // Keep the ERROR object (88-14 idiom): useFetchErrorState reads
            // `ApiError.code` off it to pick the right user-facing copy.
            setError(
                error instanceof Error ? error : new Error("The members request didn't complete.")
            );
            return LOAD_FAILED;
        } finally {
            if (isCurrent()) setLoading(false);
        }
    };

    /* Adapter onto the shared fetch-error pair, identical in shape to `friendsErrorState`
       in `friends/page.js` (88-14). `refetch` must be STABLE — the hook puts it in a
       `useCallback` dep AND in its refocus-recovery effect's deps, so handing it a fresh
       function each render would re-subscribe that listener on every render while erroring. */
    const fetchMembersRef = useRef(null);
    useEffect(() => {
        fetchMembersRef.current = fetchMembers;
    });
    const retryMembers = useCallback(() => fetchMembersRef.current?.(), []);
    const membersErrorState = useFetchErrorState({
        isError: Boolean(error) && requestedGroupId === group_id,
        error,
        refetch: retryMembers,
    });
    /* DECISION Phase 88.6.1-78 (C10 access or gone, close reset):
       CHOSEN: (1) `rosterRetained` comes from plan 88.6.1-70's `useRetainedContent` on plan
       88.6.1-42's has-loaded flag for this group (a has-loaded flag, never a row count: a roster
       that loaded EMPTY is retained content, D-50) — the one predicate for every 401 / 403 / 404 /
       410 form, remembered until the next success — so an answer saying the viewer lost access or
       the group is gone withholds the rows, the empty sentence, the pending invites and the Invite /
       Reset action row for the full banner's register line, and the RF1 notice never offers a Retry
       for it; (2) closing the dialog supersedes any in-flight run and clears a TRANSIENT error, so a
       reopen mounts the notice's region empty and speaks only about the reopen's own refresh;
       (3) while the roster is withheld the error is KEPT across the close (`rosterWithheldRef`), so
       the hook's memory survives and a reopen never paints a withdrawn roster; (4) `fetchMembers`
       returns at once while the dialog is closed, so the kept error arms no background refetch while
       the dialog is closed — the work is gated, never the error (gating the error state on `modal`
       would end the hook's memory at the close).
       REJECTED: (a) the notice over an access answer: its Retry cannot succeed and it keeps
       presenting content the viewer has lost; (b) writing an empty roster on access loss: contract
       C1 forbids writing the data, the hook withholds it; (c) clearing the error at the START of a
       run instead of on close: contract C2 forbids it (it unmounts a pressed Retry); (d) a local list
       of codes: contract C10 (this plan's earlier forbidden / not-found set missed 401 and the 410
       family); (e) clearing every error on close: it ends the hook's memory and paints the withdrawn
       roster for the length of the reopen's GET; (f) keeping only a stored access or gone code across
       the close: after a failed Try again the stored code is transient while the roster is still
       withheld; (g) keeping every error across the close: the reopen would announce a failure from
       before the close, moments before its own refresh may succeed; (h) leaving the Invite / Reset
       action row up on a withdrawn role: its controls act on authorization the latest answer
       revoked.
       Changing this is a decision, not a cleanup. */
    const rosterRetained = useRetainedContent(hasLoaded, membersErrorState);
    const rosterWithheld = hasLoaded && !rosterRetained;
    useEffect(() => {
        rosterWithheldRef.current = rosterWithheld;
    });

    // Runs ONLY after the escalation gate below has been confirmed, or directly for
    // an ungated (non-escalating) role change. Resolves true on success so the gate
    // can stay open on failure without this path having to throw at the mobile
    // kebab, which calls it outside any promise chain.
    const performRoleChange = async (target_user_id, newRole) => {
        try {
            await groupsAPI.updateUserRole(group_id, target_user_id, newRole);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
            // Req 12 receipt (UI-SPEC §6.2): `{Object} {past-tense verb}`, <=4 words,
            // no exclamation mark and no adverb — the shipped error-toast voice.
            // (The banned adverb is deliberately not spelled out here: Req 12's
            // acceptance is a plain grep over this file that does not exempt comments.)
            toast.success('Role updated');
            return true;
        } catch (error) {
            logger.info('Error updating role:', errCtx(error));
            toast.error(getFetchErrorMessage(error));
            // The boolean contract is load-bearing: `promoteAdminGate.onConfirm` rethrows on
            // `false` (`Role update failed`) so a failed escalation leaves its dialog OPEN.
            return false;
        }
    };

    /* DECISION Phase 88-12 (AR R2-M10, owner-ruled 2026-08-05): the role change is gated
       ONLY on ESCALATION to admin. Demotions and every other role change stay ungated and
       fire the API immediately, exactly as they shipped.

       REJECTED ALTERNATIVE — gating every role change, which is the symmetrical-looking
       thing to do. It loses because a demotion is self-correcting (re-promote and you are
       back where you were), so a gate there buys nothing and taxes routine management on
       the surface an admin uses most. Granting admin is the one direction that hands
       someone else power over other people's membership, which is a consequence the
       control's own label cannot convey — D-09's "does it need explaining?" rule.

       Un-gating the promotion, or extending the gate to demotions, is a decision. */
    const promoteAdminGate = useConfirmAction({
        tier: 'dialog',
        title: `Make ${promoteTarget?.name || 'this member'} an admin?`,
        body: 'Admins can edit events, manage members, and approve or remove people.',
        confirmLabel: 'Make admin',
        onConfirm: async (target_user_id) => {
            const ok = await performRoleChange(target_user_id, 'admin');
            // Rejecting keeps the gate open (useConfirmAction's contract) so the
            // person can retry or cancel rather than see it close on a failed grant.
            if (!ok) throw new Error('Role update failed');
            setPromoteTarget(null);
        },
    });

    const cancelPromoteAdmin = () => {
        promoteAdminGate.cancel();
        setPromoteTarget(null);
    };

    const handleRoleChange = (target_user_id, newRole, targetName, priorRole) => {
        if (!group_id || !user?.sub) return;
        if (newRole === 'admin') {
            setPromoteTarget({
                id: target_user_id,
                name: targetName || 'this member',
                priorRole: priorRole || 'member',
            });
            promoteAdminGate.trigger(target_user_id);
            return;
        }
        void performRoleChange(target_user_id, newRole);
    };

    // Phase 68-02, retained through 88-12: post-gate body factored out so the two
    // entry points can carry DIFFERENT gates and still share one commit path. The
    // mobile kebab's two-tap IS its confirmation and calls this directly; the
    // desktop Remove button routes through the dialog gate below and then calls
    // this. See the AR-DEC-3 marker at the kebab item for why they differ.
    const handleRemoveMemberConfirmed = async (target_user_id) => {
        if (!group_id || !user?.sub) return false;
        const settle = rosterFocusRecovery.arm({ preferred: neighbourMemberActions(target_user_id) });
        try {
            await groupsAPI.removeUserFromGroup(group_id, target_user_id);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
            // Req 12 receipt (UI-SPEC §6.2). Deliberately here and not at the two
            // call sites: the desktop dialog gate and the mobile kebab two-tap share
            // this commit path, so both surfaces get the same receipt from one line.
            toast.success('Member removed');
            return true;
        } catch (error) {
            logger.info('Error removing member:', errCtx(error));
            toast.error(getFetchErrorMessage(error));
            // `removeMemberGate.onConfirm` rethrows on `false` (`Remove failed`), which is
            // what keeps the confirm dialog OPEN after a failed remove.
            return false;
        } finally {
            settle();
        }
    };

    // Desktop Remove button — dialog tier (UI-SPEC §11.2). Copy verbatim.
    const removeMemberGate = useConfirmAction({
        tier: 'dialog',
        title: `Remove ${removeTarget?.name || 'this member'} from this group?`,
        body: "They'll lose access to events and planning. You can re-invite them.",
        confirmLabel: 'Remove',
        onConfirm: async (target_user_id) => {
            const ok = await handleRemoveMemberConfirmed(target_user_id);
            if (!ok) throw new Error('Remove failed');
        },
    });

    const handleRemoveMember = (target_user_id, targetName) => {
        if (!group_id || !user?.sub) return;
        setRemoveTarget({ id: target_user_id, name: targetName || 'this member' });
        removeMemberGate.trigger(target_user_id);
    };

    const handleApproveMember = async (target_user_id, event) => {
        if (!group_id) return;
        const settle = rosterFocusRecovery.arm({ from: event?.currentTarget });
        try {
            await groupsAPI.approveMember(group_id, target_user_id);
            await fetchMembers();
            if (onMembersUpdated) onMembersUpdated();
            // No success receipt here BY RULING, not by omission: Phase 91.1 deletes the
            // approve/reject controls (ROADMAP `### Phase 91.1: Pending-member vestige removal`), so wiring a receipt for a control a
            // later phase removes is out of scope per the 88.6 SPEC. Phase 91.1 owns it.
        } catch (error) {
            logger.info('Error approving member:', errCtx(error));
            toast.error(getFetchErrorMessage(error));
        } finally {
            settle();
        }
    };

    const performRejectMember = async (target_user_id) => {
        const settle = rosterFocusRecovery.arm();
        try {
            await groupsAPI.rejectMember(group_id, target_user_id);
            await fetchMembers();
            if (onMembersUpdated) onMembersUpdated();
            // No success receipt here BY RULING — same Phase 91.1 deletion as the approve
            // handler above (ROADMAP `### Phase 91.1: Pending-member vestige removal`). Phase 91.1 owns this control's receipt.
            return true;
        } catch (error) {
            logger.info('Error rejecting member:', errCtx(error));
            toast.error(getFetchErrorMessage(error));
            // `rejectMemberGate.onConfirm` rethrows on `false` (`Reject failed`) so a failed
            // reject leaves its dialog open.
            return false;
        } finally {
            settle();
        }
    };

    /* DECISION Phase 88-12 (OI-7 owner-ratified 2026-08-04; body corrected per
       FND-88-12-02): reject-pending is the DIALOG tier, and its body says only
       "They'll be removed from the pending list."

       The ratified copy in 88-UI-SPEC.md's "Reject pending member" row was "They'll be
       removed from the group and will need a new invite to rejoin." The second clause is
       FALSE against the shipped backend and was cut, not softened: the reject route in
       `routes/groups.js` (its `destroy({ force: true })`) hard-deletes only the
       UserGroup row — it does not rotate the group's invite_token and writes no block-list
       entry — and the join-by-token lookup (`where: { invite_token: token }`) still matches
       that STANDING token, with its membership create admitting the holder as a full
       `member` ("QR invites bypass pending"). So a rejected person
       reusing the same link does not need a new invite at all; they skip the pending queue
       entirely. The tier is unaffected and stands as ratified.

       Restoring the new-invite sentence is a decision that requires the BACKEND to change
       first (rotate the token or block the rejected user), not a copy cleanup. */
    const rejectMemberGate = useConfirmAction({
        tier: 'dialog',
        title: `Reject ${rejectTarget?.name || 'this member'}?`,
        body: "They'll be removed from the pending list.",
        confirmLabel: 'Reject',
        onConfirm: async (target_user_id) => {
            const ok = await performRejectMember(target_user_id);
            if (!ok) throw new Error('Reject failed');
        },
    });

    const handleRejectMember = (target_user_id, targetName) => {
        if (!group_id) return;
        setRejectTarget({ id: target_user_id, name: targetName || 'this member' });
        rejectMemberGate.trigger(target_user_id);
    };

    // Reset invite link — dialog tier (UI-SPEC §11.2). Copy verbatim.
    const performResetInviteToken = async () => {
        setResettingInvite(true);
        try {
            await groupsAPI.resetInviteToken(group_id);
            // The one W11 receipt this phase wires. String ratified VERBATIM in
            // 88-UI-SPEC §6.2.1 and 88.6-UI-SPEC §6.3 — no copy is authored here.
            toast.success('Invite link reset');
            return true;
        } catch (err) {
            logger.info('Failed to reset invite token:', errCtx(err));
            toast.error(getFetchErrorMessage(err));
            // `resetInviteGate.onConfirm` rethrows on `false` (`Reset invite link failed`),
            // so a failed reset leaves its dialog open rather than closing as a success.
            return false;
        } finally {
            setResettingInvite(false);
        }
    };

    const resetInviteGate = useConfirmAction({
        tier: 'dialog',
        title: 'Reset the invite link?',
        body: 'Every copy of the old link stops working — including printed QR codes.',
        confirmLabel: 'Reset link',
        onConfirm: async () => {
            const ok = await performResetInviteToken();
            if (!ok) throw new Error('Reset invite link failed');
        },
    });

    // Phase 69-04 mirror: in-row Leave Group button opens a sibling confirm
    // modal (same shape + copy as GroupSettings) instead of window.confirm.
    const handleLeaveGroup = () => {
        if (!group_id) return;
        setLeaveError('');
        setShowLeaveConfirm(true);
    };

    const handleLeaveGroupConfirmed = async () => {
        if (leaveInFlightRef.current) return;
        if (!group_id) return;
        leaveInFlightRef.current = true;
        setLeaving(true);
        setLeaveError('');
        try {
            await groupsAPI.leaveGroup(group_id);
            setShowLeaveConfirm(false);
            modaltoggle(); // Close the modal
            router.push('/');
        } catch (error) {
            logger.info('Error leaving group:', errCtx(error));
            setLeaveError(getFetchErrorMessage(error));
        } finally {
            leaveInFlightRef.current = false;
            setLeaving(false);
        }
    };

    const getRoleBadge = (role) => {
        const roleStyles = {
            owner: 'bg-purple-100 text-purple-800 border-purple-300',
            admin: 'bg-surface-muted text-content-accent border-accent',
            member: 'bg-surface-muted text-content-secondary border-line',
            pending: 'bg-amber-100 text-amber-800 border-amber-300'
        };
        
        /* DECISION Phase 88.6-19 (§4.5, D-03): the role pill keeps a WEIGHT and takes 700, not
           400 + a colour token. 600 is what UI-SPEC §4.5 removes everywhere outside `Button`, and
           of its three outcomes this family is named on the pill-ink row: a 12px label sitting in
           its own fill needs the weight to hold against the fill, and 400 would leave the pill
           distinguished by colour alone — the thing R2 #171 exists to prevent. Dropping this to
           400 is a decision. */
        return (
            <span className={`px-2 py-1 rounded-sm text-xs font-bold border ${roleStyles[role] || roleStyles.member}`}>
                {role?.charAt(0).toUpperCase() + role?.slice(1) || 'Member'}
            </span>
        );
    };

    if (!modal) return null;

    // Owner and admin can manage members
    const canManageMembers = userRole === 'owner' || userRole === 'admin';

    return (
        <>
        {/* DECISION Phase 88-12 (SPEC Req 9): all three of this file's overlays are hosted
            on the shared <Modal>, and their old hand-rolled `zIndex: 110` tiers are NOT
            re-created as bespoke z-index classes on the Radix content.

            RESOLVED STACKING (verified, not assumed — same reasoning 88-15 recorded on
            FriendInvitePanel): Radix portals every dialog to the END of <body>, so a
            later-opened dialog paints above an earlier one purely by DOM order. The
            transfer/leave confirms and the invite panel all open FROM this modal, so they
            mount after it and stack above it without any z-index of their own. The rejected
            alternative was porting `zIndex: 110` onto <Modal> via className — it
            re-introduces a bespoke tier the rest of the fleet does not have, for an
            ordering the portal already guarantees.

            The old sibling-overlay + stopPropagation dance is likewise gone rather than
            ported: it existed only so the parent's backdrop onClick could not fire through
            a child overlay, and Radix's outside-interaction handling makes it moot.
            Re-adding either is a decision, not a cleanup. */}
        <Modal open={modal} onClose={modaltoggle} className="max-w-2xl">
            <Modal.Header>
                {canManageMembers ? 'Manage Group Members' : 'Members'}
            </Modal.Header>
            {/* DECISION Phase 88.6.1-78 (AC-29 / RF1, owner ruling 2026-10-05): a failed REFRESH keeps
                what loaded (the roster, or the empty-roster sentence of a roster that loaded empty, D-50,
                ruling Y) and shows plan 88.6.1-70's shared notice with its Retry, gated by
                `rosterRetained` (a has-loaded flag for this group, never a row count).
                CHOSEN: one notice mounted for as long as the dialog is open, above the whole roster
                block (the rows, the empty sentence and the pending invites, which one fetch loads) and
                outside the dialog's scrolling body (owner ruling #242, the marker below), so its polite
                region exists before any failure and its recovery survives the rows leaving; no
                `focusTarget`, because inside a Modal the floor finds this dialog's title, the section
                heading D-05 names for this host.
                REJECTED: (a) the full banner above the kept rows, D-09a's own clause, AMENDED by D-51
                (ratified 2026-10-05): a "couldn't load" banner over a loaded roster contradicts itself;
                (b) the notice inside the rows branch: its region would be inserted with the rows, and it
                would unmount with them on an access answer, dropping focus to the dialog container;
                (c) a ref into the Modal header as `focusTarget`: `ModalHeader` takes no ref, and the
                floor reaches the same element (plan 88.6.1-42's rejection (a), same reason); (d) a
                sentence or a notice written in this file (contract C7); (e) the full banner over a
                roster that loaded empty (D-50); (f) the notice inside the scrolling body (owner ruling
                #242, the marker below).
                Changing this is a decision, not a cleanup. */}
            {/* DECISION Phase 88.6.1-78 (#242, owner 2026-10-14): CHOSEN the notice pinned under the
                dialog title, between the dialog's header and its scrolling body, so after a failed
                background refresh the notice and its Retry stay in view however far the member list is
                scrolled, at the cost of about one member row (~44px) of dialog height while the error
                shows (its spacing is applied only while it shows, the header's own inset).
                REJECTED the notice inside the scrolling body under the Invite buttons (this plan as
                first written): once the person has scrolled to a member and acted, the notice and
                Retry are above the top of the list and nothing on screen says the list is stale.
                Precedent: the home group list made the same choice for the same reason (plan
                88.6.1-77, its notice outside its scrolling list). Mockup
                https://claude.ai/artifact/JMvFMJXD1M6GkDt6xGBuYi (v2, frame 3).
                Moving this back into the scrolling body is a decision, not a cleanup. */}
            {/* DECISION Phase 88.6.1-78 (C12, focus when the roster is withdrawn):
                CHOSEN: plan 88.6.1-70's shared guard beside the RF1 notice, outside the roster block
                and the scrolling body, with no target — so when an access or gone answer withdraws
                the rows while a row control holds focus, pressed or not (the hook's tab-return
                re-attempt presses nothing), focus lands on this dialog's title through plan
                88.6.1-04's floor.
                REJECTED: (a) the guard inside the roster block: it would unmount with the rows it
                watches and never act; (b) relying on plan 88.6.1-42's three press arms: a refresh
                nobody pressed arms nothing; (c) leaving it to Radix's focus scope: its removal
                handler focuses the dialog container, which names nothing; (d) focus code written in
                this file (D-04).
                Changing this is a decision, not a cleanup. */}
            <RetainedContentFocusGuard retained={rosterRetained} />
            <RefreshFailedNotice state={membersErrorState} retained={rosterRetained} className="px-3 pt-3 md:px-6" />
            <Modal.Body>
                {userRole && userRole !== 'pending' && !rosterWithheld && (
                    <div className="mb-4 pb-4 border-b border-line flex flex-wrap gap-2">
                        <Button
                            variant="primary"
                            size="default"
                            onClick={() => setInviteModalOpen(true)}
                        >
                            Invite members
                        </Button>
                        {/* W016 row 20: aria-disabled, never native, so the reset dialog's close restore can land on this opener; its state guard stays the refusal, because the control pressed while a reset runs is the dialog's confirm (plan 88.6.1-22), not this opener. See DECISION Phase 88.6.1-50. */}
                        {canManageMembers && (
                            <Button
                                variant="secondary"
                                size="default"
                                onClick={() => {
                                    if (resettingInvite) return;
                                    resetInviteGate.trigger();
                                }}
                                aria-disabled={resettingInvite || undefined}
                                className="text-content-status-error"
                                title="Invalidate the current invite link and generate a new one"
                            >
                                {resettingInvite ? 'Resetting…' : RESET_INVITE_LINK_LABEL}
                            </Button>
                        )}
                    </div>
                )}

                {!canManageMembers && (
                    <div className="bg-surface-sunken border border-line rounded-lg p-4 mb-4">
                        <p className="text-content-secondary text-sm">
                            You're viewing the member list. Only owners and admins can change roles or remove members.
                        </p>
                    </div>
                )}

                {/* D-08: identity-resolution failure hides the self "(You)" badge
                    and the admin controls gated on the derived role — surface a
                    compact, non-blocking degrade notice rather than fail silently. */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />

                {/* DECISION Phase 88.6.1-42 (D-09a, D-33 row 20): the first-load line replaces
                    content only on the FIRST load of THIS group. A refresh (a role change, a remove,
                    an approve, a reject, a member added from the invite panel) keeps the rows
                    painted. A failed refresh keeps what loaded (the rows, or a loaded-empty
                    roster's sentence), and the full banner renders only while nothing has loaded
                    for this group; the shared RF1 notice that qualifies kept content is mounted by
                    plan 88.6.1-78. A reopen shows the last roster and refreshes behind it. The four
                    slots below are mutually exclusive by construction.

                    REJECTED, each with its reason:
                    (a) the row count as the has-loaded flag: a roster that loaded empty and a
                        roster never loaded are different states.
                    (b) a plain boolean: a reopen for another group would paint the previous
                        group's rows and their Remove controls.
                    (c) a busy marker or a visible updating line on the roster: D-09 (owner),
                        nothing extra in Manage Members; dimming old rows is Phase 88.9's.
                    (d) the full banner above kept rows, D-09a's own clause, AMENDED by D-51 (the
                        RF1 convergence the owner ratified 2026-10-05): a "couldn't load" banner
                        over a loaded roster contradicts itself.
                    (e) a row count in the retained rule (the full banner over a roster that loaded
                        EMPTY): the owner ruled on 2026-10-05 (D-50, ruling Y) that a loaded-empty
                        list is retained content; the banner there throws away the knowledge that
                        the last good read found nobody, and the RF1 notice above the sentence
                        states the failure.
                    Changing this is a decision, not a cleanup. */}
                {membersErrorState.showError && !rosterRetained && (
                    <FetchErrorBanner
                        state={membersErrorState}
                        title="Couldn't load members"
                        reportContext="manage members — member list fetch"
                    />
                )}
                {loading && !hasLoaded && !membersErrorState.showError && (
                    <p className="text-content-secondary">Loading members...</p>
                )}
                {rosterRetained && members.length === 0 && (
                    <p className="text-content-secondary">No members found.</p>
                )}
                {rosterRetained && members.length > 0 && (
                    <>
                        {/* Pending Members Section (admin/owner only) */}
                        {canManageMembers && members.filter(m => m.UserGroup?.role === 'pending').length > 0 && (
                            <div className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                    <Heading level={3} size="heading" className="text-content-primary">Pending Members</Heading>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                        {members.filter(m => m.UserGroup?.role === 'pending').length}
                                    </span>
                                </div>
                                <p className="text-sm text-content-muted mb-3">Auto-approved after 24h</p>
                                <div className="space-y-3">
                                    {members.filter(m => m.UserGroup?.role === 'pending').map((member) => (
                                        <div key={member.id} className="flex items-center justify-between p-4 border border-amber-200 rounded-lg bg-amber-50">
                                            <div className="flex items-center gap-3 flex-1">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-bold text-content-primary"><ClickableMemberName userId={member.id} username={member.username || member.email} /></p>
                                                        {getRoleBadge('pending')}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="primary"
                                                    size="default"
                                                    onClick={(event) => handleApproveMember(member.id, event)}
                                                >
                                                    Approve
                                                </Button>
                                                <Button
                                                    variant="danger"
                                                    size="default"
                                                    onClick={() => handleRejectMember(member.id, member.username || member.email)}
                                                >
                                                    Reject
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Active Members List */}
                        <div className="space-y-3">
                            {members.filter(m => m.UserGroup?.role !== 'pending').map((member) => {
                                const memberRole = member.UserGroup?.role || 'member';
                                const isCurrentUser = member.id === selfUuid;
                                const isOwner = memberRole === 'owner';

                                return (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-4 border border-line rounded-lg hover:bg-surface-hover"
                                    >
                                        <div className="flex items-center gap-3 flex-1">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-content-primary">
                                                        <ClickableMemberName userId={member.id} username={member.username || member.email} />
                                                    </p>
                                                    {isCurrentUser && (
                                                        <span className="text-xs text-content-accent">(You)</span>
                                                    )}
                                                    {/* Phase 69-02 GROUP-03: explicit Owner badge inline next to the
                                                        owner's name. Visible to ALL viewers (member/admin/owner) so
                                                        the role is always discoverable. Uses design-system tokens
                                                        for theme parity. The existing getRoleBadge() lookup also
                                                        renders the role pill on the right; this inline badge is
                                                        the canonical "this is the owner" indicator per CONTEXT. */}
                                                    {isOwner ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-surface-accent-subtle text-content-accent border border-line-accent">
                                                            Owner
                                                        </span>
                                                    ) : (
                                                        getRoleBadge(memberRole)
                                                    )}
                                                </div>
                                                {member.email && member.email !== member.username && (
                                                    <p className="text-sm text-content-secondary mt-1">{member.email}</p>
                                                )}
                                            </div>
                                        </div>

                                        {canManageMembers && !isCurrentUser && (
                                            <>
                                                {/* Phase 69-02 GROUP-03: owner row hides Remove + role-change controls
                                                    entirely (per CONTEXT, no disabled-with-tooltip — controls just
                                                    aren't rendered). Combined with the inline "Owner" badge above. */}
                                                {!isOwner && (
                                                    <>
                                                        {/* Desktop (≥768px) — role-select + Remove, both on the dialog tier */}
                                                        <div className="hidden md:flex items-center gap-2">
                                                            {/* Role Dropdown */}
                                                            {/* [Rule 2 - a11y] The role <select> shipped with no
                                                                accessible name — surfaced by the composed axe audit
                                                                added in 88-12 (axe `select-name`), which the
                                                                primitive's own suite could not see. The visible
                                                                member name is the only thing that distinguishes one
                                                                row's select from the next. */}
                                                            {/* DECISION Phase 88-12 (AR R2-M10): while an escalation gate is
                                                                OPEN for this member the select renders the PRIOR role
                                                                explicitly, so Cancel provably leaves it showing "Member".
                                                                Chosen OVER `value={memberRole}` alone, which is the obvious
                                                                shape and does revert — but only via React's implicit
                                                                controlled-input restore, an internal that no assertion in this
                                                                repo pins and that reads as an accident to anyone reviewing it.
                                                                The trap the AR named (select stuck showing "Admin" while the
                                                                backend still says "Member") is closed structurally here.
                                                                Collapsing this back to the bare `memberRole` is a decision. */}
                                                            <SelectControl
                                                                id={`member-role-${member.id}`}
                                                                name={`member-role-${member.id}`}
                                                                aria-label={`Role for ${member.username || member.email}`}
                                                                value={promoteTarget?.id === member.id ? promoteTarget.priorRole : memberRole}
                                                                onChange={(e) => handleRoleChange(
                                                                    member.id,
                                                                    e.target.value,
                                                                    member.username || member.email,
                                                                    memberRole
                                                                )}
                                                                className="w-auto"
                                                            >
                                                                <option value="member">Member</option>
                                                                <option value="admin">Admin</option>
                                                            </SelectControl>

                                                            {/* Remove Button — desktop entry point opens the dialog-tier
                                                                gate inside handleRemoveMember (Req 11, UI-SPEC §11.2). */}
                                                            <Button
                                                                variant="danger"
                                                                size="default"
                                                                onClick={() => handleRemoveMember(member.id, member.username || member.email)}
                                                                title="Remove from group"
                                                            >
                                                                Remove
                                                            </Button>

                                                            {/* Phase 69-02 GROUP-06: owner-only Transfer Ownership kebab on
                                                                desktop. Shown alongside admin controls so the owner has
                                                                surface parity with mobile. Admins do NOT see this kebab —
                                                                only the current owner can transfer (strict userRole check,
                                                                NOT canManageMembers which would include admins). */}
                                                            {userRole === 'owner' && (
                                                                <KebabMenu
                                                                    ariaLabel={`More actions for ${member.username || member.email}`}
                                                                    items={[
                                                                        {
                                                                            label: 'Transfer ownership to this member',
                                                                            danger: true,
                                                                            onClick: () => setTransferTarget({
                                                                                id: member.id,
                                                                                name: member.username || member.email || 'this member',
                                                                            }),
                                                                        },
                                                                    ]}
                                                                />
                                                            )}
                                                        </div>

                                                        {/* Mobile (<768px) — kebab collapses role swap + Remove (and
                                                            Transfer Ownership when viewer is owner) into one ⋮.
                                                            "Make member" is single-tap (a demotion is reversible and
                                                            ungated on both surfaces); "Make admin" routes to the same
                                                            escalation gate the desktop select uses. Transfer Ownership
                                                            opens its own modal (no twoTap — the modal IS the
                                                            confirmation). */}
                                                        {/* DECISION Phase 88.6-19 (D-12 / D-40): the mobile kebab
                                                            names ITS OWN MEMBER, and takes a label LEXICALLY
                                                            DISTINCT from the desktop twin's — not a copy of it.

                                                            THE DEFECT IT CLOSES: this was the row-invariant
                                                            "Member actions", so a roster of N members rendered N
                                                            buttons a screen reader announces identically, with no
                                                            way to tell which row is about to be acted on. On the
                                                            phone this menu is the ONLY path to remove a member.

                                                            WHY NOT JUST COPY THE DESKTOP WORDING ("More actions
                                                            for X"): for an OWNER both kebabs render in the SAME
                                                            row — the desktop one is gated on `userRole === 'owner'`
                                                            and this one sits inside `md:hidden`, and jsdom loads no
                                                            CSS so both breakpoint trees are in the DOM. Copying it
                                                            verbatim would yield two byte-identical accessible names
                                                            per row: one defect traded for another. Their item sets
                                                            differ too (desktop offers transfer only; this one
                                                            carries role swap + Remove + transfer), so distinct
                                                            names are honest rather than merely convenient.

                                                            The desktop `ariaLabel` is byte-unchanged — two live
                                                            test queries key on that exact string. Collapsing these
                                                            two labels into one is a decision, not a cleanup. */}
                                                        <div
                                                            className="md:hidden"
                                                            ref={(node) => {
                                                                if (node) memberActionsNodesRef.current.set(member.id, node);
                                                                else memberActionsNodesRef.current.delete(member.id);
                                                            }}
                                                        >
                                                            <KebabMenu
                                                                ariaLabel={`Member actions for ${member.username || member.email}`}
                                                                items={[
                                                                    {
                                                                        label: memberRole === 'admin' ? 'Make member' : 'Make admin',
                                                                        onClick: () => handleRoleChange(
                                                                            member.id,
                                                                            memberRole === 'admin' ? 'member' : 'admin',
                                                                            member.username || member.email,
                                                                            memberRole
                                                                        ),
                                                                    },
                                                                    /* DECISION Phase 88 AR-DEC-3 (owner, 2026-08-05): keep
                                                                       KebabMenu-internal two-tap OVER routing through
                                                                       useConfirmAction — the hook tier cannot survive an
                                                                       auto-closing menu item (D-07). The arming tap (the
                                                                       first-tap branch of KebabMenu.js's item handler,
                                                                       `if (armedIndex !== index) {`) is the ONLY tap that does not close
                                                                       the menu; hook-routing either arms without ever
                                                                       committing (silently breaking mobile remove) or closes
                                                                       on the arming tap. UI-SPEC §11.2 lists this gate as
                                                                       already shipped and tier-correct. Changing this is a
                                                                       decision, not a cleanup. */
                                                                    {
                                                                        label: 'Remove',
                                                                        danger: true,
                                                                        twoTap: true,
                                                                        confirmLabel: 'Tap again to remove',
                                                                        onClick: () => handleRemoveMemberConfirmed(member.id),
                                                                    },
                                                                    // Phase 69-02 GROUP-06: owner-only — admins don't see this item.
                                                                    ...(userRole === 'owner' ? [{
                                                                        label: 'Transfer ownership to this member',
                                                                        danger: true,
                                                                        onClick: () => setTransferTarget({
                                                                            id: member.id,
                                                                            name: member.username || member.email || 'this member',
                                                                        }),
                                                                    }] : []),
                                                                ]}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {isCurrentUser && !isOwner && (
                                            <Button
                                                variant="danger"
                                                size="default"
                                                onClick={handleLeaveGroup}
                                            >
                                                Leave Group
                                            </Button>
                                        )}
                                        {isCurrentUser && isOwner && (
                                            <p className="text-sm text-content-muted italic">Your role</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* Pending Invites Section */}
                {pendingInvites.length > 0 && rosterRetained && (
                    <div className="mt-6">
                        <div className="flex items-center gap-2 mb-3">
                            <Heading level={3} size="heading" className="text-content-primary">Pending Invites</Heading>
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                {pendingInvites.length}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {pendingInvites.map((invite) => (
                                <div
                                    key={invite.id}
                                    className="flex items-center justify-between p-4 border border-line rounded-lg bg-amber-50"
                                >
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-content-primary">
                                                    {invite.invited_email}
                                                </p>
                                                <span className="px-2 py-1 rounded-sm text-xs font-bold border bg-amber-100 text-amber-800 border-amber-300">
                                                    Pending
                                                </span>
                                            </div>
                                            <div className="text-sm text-content-secondary mt-1">
                                                {invite.invited_by_name && (
                                                    <span>Invited by {invite.invited_by_name}</span>
                                                )}
                                                {invite.created_at && (
                                                    <span className="ml-2">
                                                        on {new Date(invite.created_at).toLocaleDateString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </Modal.Body>
            <Modal.Footer>
                <Modal.Action variant="secondary" onClick={modaltoggle} className="px-6">
                    Close
                </Modal.Action>
            </Modal.Footer>
        </Modal>

        {/* Transfer Ownership confirmation — Phase 69 GROUP-06 frontend, migrated onto the
            shared <Modal> in Phase 88-12. Copy verbatim from CONTEXT D-XFER-02.

            DECISION Phase 88-12 (AR R2-M11): the shipped in-flight dismissal guard survives
            as `dismissable={!transferring}` — the primitive's OWN expression of "an
            accidental outside click must not discard this", which is exactly what the old
            `onClick={() => !transferring && ...}` backdrop guard bought. Esc and the header
            close affordance stay live while pending, per Modal.tsx's recorded contract
            ("the keyboard close path is never trapped" — WCAG 2.1.2). The rejected
            alternative was suppressing those too so the dialog is un-exitable in flight:
            that reopens a shipped a11y call to defend against an EXPLICIT close, where the
            guard was only ever about an accidental one. Changing this is a decision. */}
        <Modal
            open={!!transferTarget}
            onClose={() => setTransferTarget(null)}
            dismissable={!transferring}
            className="max-w-md"
        >
            <Modal.Header>
                Transfer ownership to {transferTarget?.name}?
            </Modal.Header>
            <Modal.Body>
                <p className="text-content-secondary">
                    You will become an admin. This cannot be undone.
                </p>
            </Modal.Body>
            <Modal.Footer>
                {/* DECISION Phase 88.6.1-50 (W016 rows 12-15, 20 / D-35, D-39): the pressed control stays
                    focusable. Chosen: aria-disabled plus a synchronous first-line REF refusal
                    (transferInFlightRef) on the control the user pressed, Transfer ownership,
                    released only in its handler's finally. The sibling Cancel KEEPS its native
                    in-flight disabled: it is a sibling nobody pressed (the rule of POSITION,
                    DECISION Phase 88.6-22 in FriendInvitePanel.js).

                    Rejected, each with its reason: native disabled on the pressed confirm (it
                    leaves the focus order mid-request, and after a failure a keyboard or switch
                    user has nothing focused to come back to, on the one path here that cannot be
                    undone); the transferring state flag as the refusal (it lands after a second
                    synchronous press has already dispatched); gating the Cancel the same way
                    (this dialog keeps the focusable confirm plus a live Escape and header close,
                    DECISION Phase 88-12 (AR R2-M11) above, so nobody is stranded); an opacity
                    utility for the busy look (the DR-C gated primary pair paints it, from the
                    .btn-primary aria-disabled rule in globals.css). Disclosed visible delta:
                    while working the button shows the gated primary pair instead of the old 50%
                    wash. MATCHED PAIR: GroupSettings' DECISION Phase 88.6.1-43 (W016 rows 10-11,
                    18-19), same ref shape, same release.

                    Confirm Leave (rows 14-15, the leave dialog below) is the same shape: the
                    pressed control carries aria-disabled with a first-line refusal through
                    leaveInFlightRef, released in handleLeaveGroupConfirmed's finally, and its
                    sibling Cancel stays native. Its busy look is plan 88.6.1-22's owner-approved
                    gated danger pair (D-39), never an opacity utility.

                    Row 20, the header's reset opener: aria-disabled while a reset runs, so it
                    stays focusable and the reset dialog's close restore can land on it (W014
                    case 1). Its existing first-line state guard stays its only refusal; a second
                    ref latch is rejected (two refusals for one gate), because the control pressed
                    while a reset runs is the dialog's confirm, not this opener. Changing this is
                    a decision, not a cleanup. */}
                <Modal.Action
                    variant="secondary"
                    disabled={transferring}
                    onClick={() => setTransferTarget(null)}
                >
                    Cancel
                </Modal.Action>
                <Modal.Action
                    variant="primary"
                    aria-disabled={transferring || undefined}
                    onClick={async () => {
                        if (transferInFlightRef.current) return;
                        if (!transferTarget) return;
                        transferInFlightRef.current = true;
                        setTransferring(true);
                        try {
                            await groupsAPI.transferOwnership(group_id, transferTarget.id);
                            setTransferTarget(null);
                            if (onMembersUpdated) onMembersUpdated();
                            if (modaltoggle) modaltoggle(); // close ManageMembers — caller refetches role
                        } catch (err) {
                            logger.info('Transfer ownership failed:', errCtx(err));
                            toast.error(getFetchErrorMessage(err));
                        } finally {
                            transferInFlightRef.current = false;
                            setTransferring(false);
                        }
                    }}
                >
                    {transferring ? 'Transferring…' : 'Transfer ownership'}
                </Modal.Action>
            </Modal.Footer>
        </Modal>

        {/* Leave Group confirmation — Phase 69-04 mirror, migrated onto the shared <Modal>
            in Phase 88-12. Copy verbatim from CONTEXT D-LEAVE-04 / Plan 69-04.
            `dismissable={!leaving}` carries the same in-flight guard as the transfer
            confirm above — see the marker there for why Esc stays live. */}
        <Modal
            open={showLeaveConfirm}
            onClose={() => { setShowLeaveConfirm(false); setLeaveError(''); }}
            dismissable={!leaving}
            className="max-w-md"
        >
            <Modal.Header>
                Leave <span className="text-content-accent">{group_name}</span>?
            </Modal.Header>
            <Modal.Body>
                <p className="text-content-secondary">
                    You will lose access to events, library, and member-only content.
                </p>
                {/* DECISION Phase 88.6-19 (R1 third arm / WCAG 4.1.3): the leave failure keeps
                    its message IN THIS MODAL and is ANNOUNCED — the region is the house
                    `StatusRegion` at `politeness="polite"`, mounted UNCONDITIONALLY with an
                    empty message, and the Confirm control points at it with
                    `aria-describedby`.

                    CHOSEN OVER TWO THINGS, both of which look right and are not:
                      (a) moving this to a `toast.error`. This modal STAYS OPEN on failure and
                          this line is its only failure surface, so a toast would leave the
                          person looking at a dialog that gives no reason — on the one path
                          here that cannot be undone.
                      (b) `{leaveError && <StatusRegion …>}`. A conditionally-mounted POLITE
                          live region announces NOTHING (the EMPTY-FIRST bullet of
                          `StatusRegion.tsx`'s docblock); the mount and the text would enter the
                          DOM together. The empty-first mount IS the mechanism. This holds for
                          this polite region and is not a rule for alerts: an inserted
                          `role="alert"` that arrives with its text IS announced (ARIA 1.2, D-42).

                    Hand-rolling an `aria-live` div instead is also rejected: the primitive
                    supplies `role`, `aria-live` AND `aria-atomic` in one contract. This arm is
                    written identically for GroupSettings' leave-failure region (plan 88.6-20;
                    now on the same prop under `DECISION Phase 88.6.1-43`) and for the
                    structurally identical bare error `<p>`s plan 88.6-22 owns — one phase must
                    not ship two standards for one markup shape.

                    AMENDED Phase 88.6.1-50 (D-22, D-42): the region now takes the house
                    `srOnlyWhenEmpty` prop. It is hidden only while it is empty, it is the same
                    node in both states, and it is visible the moment it holds text (the owner's
                    visible-when-set ruling, 2026-09-14). The conditional margin it carried is
                    retired for the one house shape (AC-26), which is exactly what this marker's
                    own "one standard for one markup shape" asks for: the margin is now
                    unconditional, costs nothing while the empty region is out of flow, and is
                    today's 16px gap once a message shows. The empty region's containing block is
                    the dialog's fixed, overflow-clipped content, so it extends no scroll area
                    (the adopter caveat on the prop). D-42 is the qualification in (b) above.
                    Re-conditioning the mount, or dropping the `aria-describedby`, is a decision,
                    not a cleanup. */}
                <StatusRegion
                    id={leaveErrorId}
                    politeness="polite"
                    message={leaveError}
                    className="mt-4 text-content-status-error"
                    srOnlyWhenEmpty
                />
            </Modal.Body>
            <Modal.Footer>
                {/* W016 rows 14-15 follow DECISION Phase 88.6.1-50 at the transfer footer; the danger look is plan 88.6.1-22's owner-approved gated pair (D-39). */}
                <Modal.Action
                    variant="secondary"
                    disabled={leaving}
                    onClick={() => { setShowLeaveConfirm(false); setLeaveError(''); }}
                >
                    Cancel
                </Modal.Action>
                <Modal.Action
                    variant="danger"
                    aria-disabled={leaving || undefined}
                    aria-describedby={leaveErrorId}
                    onClick={handleLeaveGroupConfirmed}
                >
                    {leaving ? 'Leaving…' : 'Confirm Leave'}
                </Modal.Action>
            </Modal.Footer>
        </Modal>

        {/* Req 11 tiered gates. Each is rendered UNCONDITIONALLY and exactly ONCE for the
            whole roster — the hook owns which member is targeted, so a per-row copy would
            mount one dialog per member. `statusNode` is likewise mounted once and always: it
            is a POLITE region (`useConfirmAction` gives it no politeness), and a
            conditionally-mounted polite region announces nothing. An inserted `role="alert"`
            that arrives with its text IS announced (ARIA 1.2, D-42), so this is not a rule for
            alerts. All four are `dialog` tier
            today, which renders `statusNode` silent — it is still mounted so that
            retiering any of them to `two-tap` stays the one-word edit the primitive
            promises. */}
        <ConfirmDialog {...removeMemberGate.dialogProps} />
        {removeMemberGate.statusNode}
        <ConfirmDialog {...rejectMemberGate.dialogProps} />
        {rejectMemberGate.statusNode}
        <ConfirmDialog {...resetInviteGate.dialogProps} />
        {resetInviteGate.statusNode}
        {/* onCancel is overridden (and only here) so aborting also drops the pending
            escalation target — that is what makes the select revert. */}
        <ConfirmDialog {...promoteAdminGate.dialogProps} onCancel={cancelPromoteAdmin} />
        {promoteAdminGate.statusNode}

        {/* Invite members modal — sibling overlay so it stacks above ManageMembers
            and clicking inside it doesn't trigger the parent's backdrop close. */}
        <FriendInvitePanel
            group={{ id: group_id, name: group_name }}
            open={inviteModalOpen}
            onClose={() => setInviteModalOpen(false)}
            onMemberAdded={() => {
                if (onMembersUpdated) onMembersUpdated();
                fetchMembers();
            }}
        />
        </>
    );
}

export default ManageMembers;

