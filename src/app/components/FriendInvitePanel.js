'use client';
import { useState, useEffect, useRef } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, invitesAPI, groupsAPI } from '../../lib/api';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { UserChip } from '@/components/ui/UserChip';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { DialogClose, DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { logger, errCtx } from '@/lib/logger';

// `openedFrom` is the entry point this panel was opened from: 'create' is the
// auto-open immediately after a group is created (createGroup.js) and swaps in
// the context copy of UI-SPEC §6.3; every other entry point keeps the generic
// header. Deliberately a plain comment, NOT a JSDoc `@param` block — under
// checkJs a partial @param list becomes the component's whole props type and
// every other prop then fails to typecheck at the call sites.
function FriendInvitePanel({ group, open, onClose, onMemberAdded, isAdmin = false, openedFrom = 'default' }) {
    const { user } = useUser();
    // FE-18 cutover: exclude-self keys on the resolved Users.id UUID (async).
    const { selfUuid } = useSelfIdentity();

    const [friends, setFriends] = useState([]);
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [groupMemberIds, setGroupMemberIds] = useState([]);
    const [loadingMembers, setLoadingMembers] = useState(false);

    const [selectedFriends, setSelectedFriends] = useState(new Set());
    const [inviting, setInviting] = useState(false);
    const [inviteResult, setInviteResult] = useState(null);

    // Email invite state
    const [email, setEmail] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailError, setEmailError] = useState('');
    const [emailSuccess, setEmailSuccess] = useState('');

    // Add friend prompt state
    const [friendPrompt, setFriendPrompt] = useState(null); // { id, username, email } — id is the Users.id UUID
    const [addingFriend, setAddingFriend] = useState(false);
    const [friendRequestSent, setFriendRequestSent] = useState(false);

    // QR code invite state
    const [inviteUrl, setInviteUrl] = useState(null);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [resetting, setResetting] = useState(false);

    /* DECISION Phase 88.6-22 (R3 #149, the rule of KIND + the rule of POSITION): every gated
       BUTTON on this surface carries `aria-disabled` plus a SYNCHRONOUS first-line ref latch
       released in a `finally` — chosen OVER the native `disabled` attribute it shipped with.

       THE RULE, as plans 17 and 18 state it identically (88.6-17-PLAN.md:231-247,
       88.6-18-PLAN.md:225-230). In-flight/busy gates normally KEEP native `disabled` — they are
       WCAG-exempt and the `.btn:disabled` wash is the right treatment. The rule of POSITION is
       the addition: an in-flight gate keeps native `disabled` EXCEPT on the control the user
       just activated, where `DECISION Phase 88.5`'s idiom applies instead — a natively disabled
       element leaves the focus order, so a keyboard or switch user is stranded mid-submit
       (NextGameNightCard.tsx:379-391 spells this out). All four gated buttons here sit on the
       control being activated, so all four move.

       WHY BOTH HALVES OR NEITHER: `aria-disabled` refuses nothing at the DOM level. A gated
       control with no handler refusal is a re-submittable button — strictly worse than the
       native attribute. The latch is a REF, not the state flag, because `setX(true)` does not
       land before a second synchronous press dispatches.

       WHAT STAYS NATIVE, and it is the rule of KIND, not an oversight: the already-in-group
       friend CHECKBOX (a gate on a control nobody activated) and the email `<Input>` while
       sending (the user pressed the Send button, not the field). Plan 17 made the same split at
       userProfile/page.js — see its `saveInFlightRef` marker, where the INVALID-INPUT gate
       deliberately stayed native. This file's Send button is the documented exception to that:
       its `!email.trim()` half ALSO moves, because that button is the only tabbable target
       after the email field and gating it natively is the keyboard dead end
       `DECISION Phase 88.8 DR-C` records. The empty press now reports instead of returning
       silently.

       VISIBLE DELTA, disclosed rather than discovered: a gated `.btn` used to take
       `.btn:disabled { opacity: .5 }` (globals.css:2250-2253) and now takes the DR-C gated
       COLOUR pair (`.btn-primary[aria-disabled='true']` at :2329, `.btn-secondary[...]` at
       :2334). Fill and ink swap instead of the whole control washing out.

       Dropping either half of any pair, or restoring the native attribute, is a decision, not
       a cleanup. */
    const bulkInviteInFlightRef = useRef(false);
    const emailInviteInFlightRef = useRef(false);
    const addFriendInFlightRef = useRef(false);
    const resetInviteInFlightRef = useRef(false);

    // Fetch friends on open
    useEffect(() => {
        if (open && user) {
            setLoadingFriends(true);
            friendshipsAPI.getFriends()
                .then(data => setFriends(Array.isArray(data) ? data : []))
                .catch(() => setFriends([]))
                .finally(() => setLoadingFriends(false));
        }
    }, [open, user]);

    // Fetch group members when group changes
    useEffect(() => {
        if (open && group?.id) {
            setLoadingMembers(true);
            setSelectedFriends(new Set());
            setInviteResult(null);
            groupsAPI.getGroupMembers(group.id)
                .then(members => {
                    const memberList = Array.isArray(members) ? members : members?.members || [];
                    // Roster side of the already-in-group join keys on the
                    // Users.id UUID (member.id) — matches the friend side
                    // (friend.id) so the join is UUID-vs-UUID pre-/post-PR-C.
                    setGroupMemberIds(memberList.map(m => m.id));
                })
                .catch(() => setGroupMemberIds([]))
                .finally(() => setLoadingMembers(false));
        } else {
            setGroupMemberIds([]);
        }
    }, [open, group?.id]);

    // Fetch invite token for QR code when panel opens
    useEffect(() => {
        if (open && group?.id) {
            setTokenLoading(true);
            groupsAPI.getInviteToken(group.id)
                .then(data => setInviteUrl(data.invite_url))
                .catch(() => setInviteUrl(null))
                .finally(() => setTokenLoading(false));
        }
    }, [open, group?.id]);

    // Reset state when panel closes
    useEffect(() => {
        if (!open) {
            setSelectedFriends(new Set());
            setInviteResult(null);
            setEmail('');
            setEmailError('');
            setEmailSuccess('');
            setFriendPrompt(null);
            setFriendRequestSent(false);
            setInviteUrl(null);
            setCopied(false);
        }
    }, [open]);

    const toggleFriend = (friendUserId) => {
        setSelectedFriends(prev => {
            const next = new Set(prev);
            if (next.has(friendUserId)) {
                next.delete(friendUserId);
            } else {
                next.add(friendUserId);
            }
            return next;
        });
    };

    const handleBulkInvite = async () => {
        // The in-flight refusal, synchronous and FIRST — see the latch marker above.
        if (bulkInviteInFlightRef.current) return;
        if (!group?.id || selectedFriends.size === 0) return;
        bulkInviteInFlightRef.current = true;
        setInviting(true);
        setInviteResult(null);

        let successCount = 0;
        let failCount = 0;
        let alreadyCount = 0;
        // DECISION Phase 88.6-22 (R1 / DEF-88-25-01): the FIRST non-terminal failure is kept so
        // the all-failed branch can render the ratified register line instead of the ad-hoc
        // 'Failed to send invites…' string it shipped. Chosen OVER keeping that string with a
        // stale roster entry: `fetchErrorTreatment.test.ts`'s FAILED_COPY_EXEMPT is exact in
        // BOTH directions, so fixing only this file's other two sites would leave an unowned
        // entry for a string P1 forbids authoring. Only the FIRST is kept — collecting all of
        // them would mean choosing between N messages with no rule for which to show.
        let firstFailure = null;

        try {
            for (const friendUserId of selectedFriends) {
                // Skip anyone already in the group; otherwise invite by user_id.
                // The friend's email is resolved server-side (83-06 PII default-deny).
                if (groupMemberIds.includes(friendUserId)) continue;
                try {
                    await invitesAPI.sendFriendInvite(group.id, friendUserId);
                    successCount++;
                } catch (err) {
                    // Wave-12 review MED #9: fork-F contract — a terminal 409
                    // (already a member / invite pending) is not a FAILURE; count
                    // it separately instead of collapsing into failCount. Prose
                    // fallback removed post-88-34 deploy (2026-08-21, owner-ruled):
                    // the ERROR_REGISTRY codes are on the wire, so the code checks
                    // are the whole contract here — an unrecognized 409 stays in
                    // failCount rather than being silently counted "already".
                    const code = err?.code;
                    const isTerminal409 = code === 'already_member' || code === 'invite_pending';
                    if (isTerminal409) {
                        alreadyCount++;
                    } else {
                        failCount++;
                        if (!firstFailure) firstFailure = err;
                    }
                }
            }

            setInviteResult({ successCount, failCount, alreadyCount, firstFailure });
            setSelectedFriends(new Set());
            setInviting(false);

            if (successCount > 0 && onMemberAdded) {
                onMemberAdded();
            }
        } finally {
            // Released in `finally` so a FAILED pass does not strand the control.
            bulkInviteInFlightRef.current = false;
        }
    };

    const handleEmailInvite = async (e) => {
        e.preventDefault();
        // The in-flight refusal, synchronous and FIRST — see the latch marker above.
        if (emailInviteInFlightRef.current) return;
        if (!group?.id) return;
        if (!email.trim()) {
            /* DECISION Phase 88.6-22 (R3 #149): the empty-field press REPORTS instead of
               returning silently. The shipped code returned bare here while the Send button was
               natively `disabled` on the same condition, so the state was unreachable; with the
               gate on `aria-disabled` the press arrives and must answer.

               The `<form>` carries `noValidate` for the same reason — see the marker there. The
               string is FIXED and app-authored (no interpolation, and deliberately not a
               "Failed to …" shape, which P1 forbids and `fetchErrorTreatment.test.ts`'s
               AD_HOC_FAILURE_COPY scan would catch). REJECTED: the browser's `required` bubble,
               which is unstyleable, untranslated and does not reach the region this surface now
               announces through. */
            setEmailSuccess('');
            setEmailError('Enter an email address to send an invite.');
            return;
        }

        const invitedEmail = email.trim();
        emailInviteInFlightRef.current = true;
        setEmailLoading(true);
        setEmailError('');
        setEmailSuccess('');
        setFriendPrompt(null);
        setFriendRequestSent(false);

        try {
            await invitesAPI.sendInvite(group.id, invitedEmail);
            setEmailSuccess(`Invite sent to ${invitedEmail}`);
            setEmail('');
            if (onMemberAdded) onMemberAdded();

            // SEAM-02 (BUG-03): resolve the user by email FIRST, then decide
            // friend-existence on the Users.id UUID. The friend email is stripped
            // from the friends payload post-83-06, so the old email-equality guard
            // was ALWAYS false — every existing-friend invite mis-prompted
            // "Add X as a friend?". A pre-search email compare can't work
            // (no friend identity still carries the email), so the existence
            // check MUST run after the search resolves foundUser and compare
            // on foundUser.id (Phase 87.3-06 PR-B).
            try {
                const foundUser = await friendshipsAPI.searchUserByEmail(invitedEmail);
                // Post-invite add-friend chain cut as ONE unit on the Users.id
                // UUID: (1) presence guard on foundUser.id (PR-C drops the flat
                // user_id from this response — a flat guard would silently kill
                // the prompt for everyone); (2) exclude-self on selfUuid with
                // async-gating — require selfUuid resolved before concluding
                // "not self" (never offer the prompt off a false negative while
                // identity is unresolved); (3) isAlreadyFriend joins both sides
                // on .id.
                if (foundUser && foundUser.id && selfUuid && foundUser.id !== selfUuid) {
                    const isAlreadyFriend = friends.some(f => f.friend?.id === foundUser.id);
                    if (!isAlreadyFriend) {
                        setFriendPrompt({
                            id: foundUser.id,
                            username: foundUser.username,
                            email: foundUser.email,
                        });
                    }
                }
            } catch {
                // User not found or search failed — no prompt, that's fine
            }
        } catch (err) {
            // Wave-12 review MED #9: fork-F contract — branch on the BE envelope
            // code (88-34 ERROR_REGISTRY). The pre-88-34-deploy prose fallback
            // (message.includes arms, incl. the long-dead 'already been invited'
            // string no BE code emits) was removed 2026-08-21 once the deploy
            // was confirmed live — the owner-ruled removal condition.
            const code = err?.code;
            if (code === 'already_member') {
                setEmailError('This person is already a member of the group');
            } else if (code === 'invite_pending') {
                setEmailError('This person already has a pending invite');
            } else {
                /* DECISION Phase 88.6-22 (R2 #39 / R1 / DEF-88-25-01): the else arm routes
                   through the ratified register with NO `fallback`, chosen OVER the ad-hoc
                   'Failed to send invite' it shipped. A code-less failure now resolves to
                   MESSAGE_BY_CODE.unknown; passing a fallback here would keep an authored
                   string alive on the very surface this sweep converges.

                   The two code arms ABOVE are kept deliberately. Measured 2026-09-16:
                   MESSAGE_BY_CODE carries byte-identical copy for both
                   (`useFetchErrorState.ts:88` already_member, `:91` invite_pending), so keeping
                   them costs nothing and preserves the surface-owns-its-richer-resting-copy
                   precedence that file records at `:80-87`. Collapsing them into the helper is
                   a decision, not a cleanup. */
                setEmailError(getFetchErrorMessage(err));
            }
        } finally {
            setEmailLoading(false);
            // Released in `finally` so a FAILED send does not strand the control.
            emailInviteInFlightRef.current = false;
        }
    };

    const handleAddFriend = async () => {
        // The in-flight refusal, synchronous and FIRST — see the latch marker above. There was
        // NO in-flight guard here before: the shipped `disabled={addingFriend}` was the only
        // thing stopping a second press, so moving it to `aria-disabled` without this latch
        // would have made the control re-submittable.
        if (addFriendInFlightRef.current) return;
        if (!friendPrompt?.id) return;
        addFriendInFlightRef.current = true;
        setAddingFriend(true);
        try {
            await friendshipsAPI.sendRequest(friendPrompt.id);
            setFriendRequestSent(true);
        } catch {
            // Silently fail — they may already have a pending request
            setFriendRequestSent(true);
        } finally {
            setAddingFriend(false);
            addFriendInFlightRef.current = false;
        }
    };

    const handleCopyLink = async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            logger.info('Failed to copy link:', errCtx(err));
        }
    };

    // GUARD-02 G5: no blocking browser dialogs on a touched path. The
    // destructive reset is confirmed via a sonner toast action button, and
    // failures surface through toast.error (live-region backed) instead of a
    // blocking modal.
    const doResetInviteLink = async () => {
        // The in-flight refusal, synchronous and FIRST — see the latch marker above. The
        // shipped `resetting` read is a STATE read and cannot refuse a second synchronous
        // press; it is kept because it also short-circuits the confirm toast below.
        if (resetInviteInFlightRef.current) return;
        if (!group?.id || resetting) return;
        resetInviteInFlightRef.current = true;
        setResetting(true);
        try {
            const data = await groupsAPI.resetInviteToken(group.id);
            setInviteUrl(data.invite_url);
            toast.success('Invite link reset. The old QR code and link no longer work.');
        } catch (err) {
            logger.info('Failed to reset invite token:', errCtx(err));
            /* DECISION Phase 88.6-22 (W15 / R1 / DEF-88-25-01, UI-SPEC §6.4): the toast keeps
               its INTENT — this action still reports its own failure — and stops quoting the
               backend. `err.message` is `body.message ?? body.error ?? \`HTTP error! status: N\``
               (api.ts extractErrorMessage), so whatever the server said landed verbatim in the
               DOM. No `fallback` is passed: UI-SPEC §6.3 ratifies no string for this action, and
               the plan's own idiom is that a code-less failure resolves to the register's
               `unknown` line rather than to a newly authored one. Reinstating a fallback here
               means authoring copy §6.3 did not ratify — a decision, not a cleanup. */
            toast.error(getFetchErrorMessage(err));
        } finally {
            setResetting(false);
            resetInviteInFlightRef.current = false;
        }
    };

    const handleResetInviteLink = () => {
        if (resetInviteInFlightRef.current) return;
        if (!group?.id || resetting) return;
        toast('Reset invite link?', {
            description: 'The current QR code and link will stop working.',
            action: {
                label: 'Reset',
                onClick: () => doResetInviteLink(),
            },
        });
    };

    /* DECISION Phase 88-15 (SPEC Req 7 / §6.3, owner deferral 2026-08-04): the
       create path gets its OWN header and lead-in; every other entry point keeps
       the generic "Invite Members". The owner himself misread the auto-opened
       panel as an accidental click-through because a generic header gives no
       hint it is a follow-on step of "create a group".

       The rejected alternative was changing the header everywhere (one string,
       no prop) — it loses because the copy only makes sense straight after a
       creation, and reads as a non-sequitur from ManageMembers / userHome. The
       auto-open itself is deliberately KEPT (owner: "keep the flow, fix the
       legibility") — removing it is a decision, not a cleanup.

       T-88-15-01: `group.name` is user-supplied and is interpolated into the
       header. It is rendered as a JSX text child, so React escapes it. Never
       build this header through `dangerouslySetInnerHTML` or an HTML string. */
    const fromCreate = openedFrom === 'create' && Boolean(group?.name);
    const headerTitle = fromCreate
        ? `${group.name} is live — who's in?`
        : 'Invite Members';
    const headerLeadIn = fromCreate
        ? 'Invite the people you actually play with. You can always add more later.'
        : (group?.name ? `to ${group.name}` : null);

    const availableFriends = friends.filter(f => f.friend);
    const selectableCount = availableFriends.filter(f => !groupMemberIds.includes(f.friend.id)).length;

    const body = (
        <>
                    {/* Friends section */}
                    <div className="p-5">
                        <Heading level={3} size="label" className="text-content-muted uppercase tracking-wide mb-3">
                            Your Friends
                        </Heading>

                        {loadingFriends || loadingMembers ? (
                            /* 88-33 Task 1: generic "Loading..." named per the walk's
                               in-page-loading-states row — the heading above says what section
                               this is, but the status itself said nothing to a screen reader. */
                            <div role="status" aria-label="Loading your friends" className="flex items-center gap-2 text-content-muted py-6 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
                                <span>Loading your friends...</span>
                            </div>
                        ) : availableFriends.length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-content-muted text-sm">No friends yet.</p>
                                <a href="/friends" className="text-content-link text-sm hover:underline mt-1 inline-block">
                                    Add friends
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {availableFriends.map(friendship => {
                                    const friend = friendship.friend;
                                    // Friend side of the membership join + the bulk-invite write arg
                                    // (selectedFriends → sendFriendInvite) all key on the Users.id UUID
                                    // (friend.id), matching the roster side (member.id).
                                    const isInGroup = groupMemberIds.includes(friend.id);

                                    return (
                                        <label
                                            key={friendship.id}
                                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                                isInGroup
                                                    ? 'border-line bg-surface-page cursor-default'
                                                    : selectedFriends.has(friend.id)
                                                        ? 'border-accent bg-surface-muted cursor-pointer'
                                                        : 'border-line hover:bg-surface-hover cursor-pointer'
                                            }`}
                                        >
                                            <input
                                                id={`invite-friend-${friend.id}`}
                                                name={`invite-friend-${friend.id}`}
                                                type="checkbox"
                                                checked={isInGroup || selectedFriends.has(friend.id)}
                                                disabled={isInGroup}
                                                onChange={() => toggleFriend(friend.id)}
                                                className="h-4 w-4 rounded-sm border-line text-content-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:opacity-40"
                                            />
                                            <div className="flex-1 min-w-0">
                                                {/* UI-SPEC §4.5, the EMPHASIS outcome: `font-medium` deleted, the
                                                    distinction carried by the colour token the ternary already
                                                    supplies. 500 is not on the 400/700 scale. */}
                                                <p className={`truncate ${isInGroup ? 'text-content-muted' : 'text-content-primary'}`}>
                                                    {friend.username}
                                                </p>
                                                {/* Friend email is no longer exposed in the friends payload (Phase 83-06 PII default-deny); invites resolve it server-side by user_id. */}
                                            </div>
                                            {isInGroup && (
                                                <span className="text-xs text-content-muted italic shrink-0">
                                                    In group
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {/* Bulk invite button */}
                        {selectableCount > 0 && (
                            <div className="mt-4">
                                <Button
                                    variant="primary"
                                    size="default"
                                    onClick={handleBulkInvite}
                                    aria-disabled={selectedFriends.size === 0 || inviting ? 'true' : undefined}
                                    aria-busy={inviting || undefined}
                                    className="w-full"
                                >
                                    {inviting && (
                                        <div aria-hidden="true" className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    )}
                                    {inviting
                                        ? 'Sending...'
                                        : selectedFriends.size > 0
                                            ? `Invite ${selectedFriends.size} Friend${selectedFriends.size !== 1 ? 's' : ''}`
                                            : 'Select friends to invite'}
                                </Button>

                                {inviteResult && (
                                    /* DECISION Phase 88-27 (D-32 buckets A/B): only the first branch
                                       is a censused tint row. The other two were converged anyway,
                                       chosen OVER touching just the censused one — that would have
                                       left `bg-amber-50 text-amber-700 border-amber-200` and
                                       `bg-red-50 …` beside a token-based sibling, and those raw
                                       literals are light-only values on a card that flips to
                                       `#232d3e`, so they were already wrong in dark mode. The
                                       IDENTICAL bulk-invite result block at friends/page.js:740-743
                                       already uses status tokens on all three branches, so this
                                       converges the outlier onto shipped precedent rather than
                                       inventing a treatment. Reverting to raw palette is a
                                       decision, not a cleanup. */
                                    /* UI-SPEC §4.5, the EMPHASIS outcome: `font-medium` deleted;
                                       all three branches already carry a status colour token. */
                                    <div className={`mt-2 p-3 rounded-lg text-sm ${
                                        inviteResult.failCount === 0
                                            ? 'bg-status-success-subtle text-content-status-success border border-status-success'
                                            : inviteResult.successCount > 0
                                                ? 'bg-status-warning-subtle text-content-status-warning border border-status-warning'
                                                : 'bg-status-error-subtle text-content-status-error border border-status-error'
                                    }`}>
                                        {inviteResult.failCount === 0
                                            ? (inviteResult.alreadyCount > 0
                                                ? (inviteResult.successCount > 0
                                                    ? `Invited ${inviteResult.successCount} — ${inviteResult.alreadyCount} already invited or a member`
                                                    : 'Everyone selected was already invited or a member')
                                                : `Invited ${inviteResult.successCount} friend${inviteResult.successCount !== 1 ? 's' : ''}!`)
                                            : inviteResult.successCount > 0
                                                ? `Invited ${inviteResult.successCount}, ${inviteResult.failCount} failed`
                                                : getFetchErrorMessage(inviteResult.firstFailure)}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="px-5">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 border-t border-line" />
                            {/* UI-SPEC §4.5 Eyebrow role (D-03): Caption 12 / 700 / uppercase /
                                tracking. `font-bold` ADDED; `tracking-wide` is the spelling the
                                nearest shipped eyebrow uses (CalendarListView.js:823). See the
                                DECISION marker on the second eyebrow below. */}
                            <span className="text-xs font-bold text-content-muted uppercase tracking-wide">or</span>
                            <div className="flex-1 border-t border-line" />
                        </div>
                    </div>

                    {/* Email invite section */}
                    <div className="p-5">
                        {/* `id` CARRIED THROUGH THE MIGRATION (WCAG 4.1.2): the `<Input>` below is
                            `aria-labelledby="invite-by-email-heading"`, so this heading is that
                            field's ONLY accessible name. Dropping the `id` here leaves an input
                            with an empty name and no failing build. Safe as an idref target
                            because the children are a STATIC non-empty string — `Heading` renders
                            NOTHING for empty children (Heading.tsx:162) and would take the `id`
                            with it. */}
                        <Heading
                            level={3}
                            size="label"
                            id="invite-by-email-heading"
                            className="text-content-muted uppercase tracking-wide mb-3"
                        >
                            Invite by Email
                        </Heading>
                        {/* DECISION Phase 88.6-22 (R3 #149): `noValidate`, chosen OVER leaving the
                            browser's constraint validation on. The Send button's `!email.trim()`
                            gate moved to `aria-disabled`, so an empty press now REACHES this form
                            — and with native validation on, the UA bubble fires and `onSubmit`
                            never runs, so the app-authored message the plan commissions could
                            never be shown. `required` is KEPT on the field: it still conveys
                            `aria-required` to assistive technology.

                            CONSEQUENCE, disclosed: a malformed address no longer gets the UA's
                            type=email bubble. It reaches the backend and returns through the
                            ratified register instead of an unstyleable, untranslated browser
                            popup. Restoring native validation would silence the empty-field
                            message again — a decision, not a cleanup. */}
                        <form onSubmit={handleEmailInvite} noValidate className="flex gap-2">
                            {/* 88-33 Task 8 (fork 5): id/name for the autofill heuristic; the
                                visible "Invite by Email" heading IS the label — associated via
                                aria-labelledby rather than duplicating it as a second label. */}
                            <Input
                                id="invite-email"
                                name="invite-email"
                                aria-labelledby="invite-by-email-heading"
                                type="email"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setEmailError('');
                                    setEmailSuccess('');
                                }}
                                placeholder="user@example.com"
                                required
                                aria-invalid={emailError ? 'true' : undefined}
                                aria-describedby={emailError ? 'invite-email-error' : undefined}
                                disabled={emailLoading}
                                className="flex-1 disabled:opacity-50"
                            />
                            <Button
                                variant="primary"
                                size="default"
                                type="submit"
                                aria-disabled={emailLoading || !email.trim() ? 'true' : undefined}
                                className="shrink-0"
                            >
                                {emailLoading ? 'Sending...' : 'Send'}
                            </Button>
                        </form>
                        {/* DECISION Phase 88.6-22 (R2 #177): this is a real FIELD error on the
                            email input, so it takes `politeness="assertive"` — `role="alert"` +
                            `aria-live="assertive"` (StatusRegion.tsx:40-41) — and spells its id,
                            its `aria-describedby` and its `aria-invalid` flip the way the shipped
                            field-error primitive does (FormField.tsx:78 `${controlId}-error`, :81
                            and :88 the composed describedby, :87 aria-invalid, :105 role=alert).
                            That makes this the SECOND spelling of the field error in the phase,
                            never a third.

                            REJECTED — adopting `FormField` itself, which on the merits is the
                            better home since it supplies all three attributes. Its `label` prop is
                            REQUIRED and always renders a visible `<label>` (FormField.tsx:95-101),
                            which would put a second visible "Invite by Email" above this input and
                            REVERSE the 88-33 Task 8 (fork 5) decision recorded ten lines up — that
                            the visible heading IS the label, associated rather than duplicated.
                            A visible duplicate label plus a reversed prior ruling is a CONSEQUENCE,
                            not bookkeeping.

                            MOUNTED UNCONDITIONALLY with an empty message: a screen reader
                            announces a CHANGE to a live region, not the conditional mount of a new
                            one. `mt-2` applies ONLY when filled, so the empty region adds no
                            visible space — the alternative (a wrapper div carrying the margin) was
                            rejected as an extra element for the same result. The error ink rides
                            on `className` because StatusRegion.tsx:43 is `cn('text-sm', className)`.
                            `text-red-500` (#ef4444) measured 3.76:1 on --color-bg-card (#ffffff),
                            below the 4.5:1 AA floor; `text-content-status-error`
                            (--color-status-error-text #991b1b, globals.css:1552) measures 8.31:1. */}
                        <StatusRegion
                            id="invite-email-error"
                            politeness="assertive"
                            message={emailError}
                            className={`text-content-status-error${emailError ? ' mt-2' : ''}`}
                        />
                        {/* R3 #148 / r2 #182: the SUCCESS announced too. A surface that announces
                            every failure and no success tells a screen-reader user the invite
                            failed silently. Polite, and a separate region from the assertive error
                            one — UI-SPEC §6.2's "exactly one live region per FAILURE" is not
                            breached by a success region (the A-31 precedent). */}
                        <StatusRegion
                            id="invite-email-status"
                            message={emailSuccess}
                            className={`text-content-status-success${emailSuccess ? ' mt-2' : ''}`}
                        />
                        {friendPrompt && !friendRequestSent && (
                            <div className="mt-3 p-3 bg-surface-sunken border border-line rounded-lg flex items-center justify-between gap-3">
                                {/* PRIM-04 adoption: render the resolved found-user identity
                                    via the shared UserChip primitive. */}
                                <div className="min-w-0">
                                    <UserChip
                                        user={{ name: friendPrompt.username || friendPrompt.email }}
                                        size="sm"
                                    />
                                    <p className="text-xs text-content-muted mt-0.5">Add as a friend?</p>
                                </div>
                                <Button
                                    variant="primary"
                                    size="default"
                                    onClick={handleAddFriend}
                                    aria-disabled={addingFriend ? 'true' : undefined}
                                    className="shrink-0"
                                >
                                    {addingFriend ? 'Sending...' : 'Add Friend'}
                                </Button>
                            </div>
                        )}
                        {/* The third silent success on this surface, closed for the same reason as
                            the email one directly above: `friendRequestSent` also flips the prompt
                            block away, so a screen-reader user who pressed "Add Friend" got no
                            confirmation at all. Always-mounted and polite; the visible copy, its
                            position and its classes are byte-identical to the `<p>` it replaces. */}
                        <StatusRegion
                            id="invite-friend-request-status"
                            message={friendRequestSent ? 'Friend request sent!' : ''}
                            className={`text-content-status-success${friendRequestSent ? ' mt-2' : ''}`}
                        />
                    </div>

                    {/* QR Code invite section -- only when group context exists */}
                    {group?.id && (
                        <>
                            {/* Divider */}
                            <div className="px-5">
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 border-t border-line" />
                                    {/* DECISION Phase 88.6-22 (D-03, UI-SPEC §4.5): the two "or"
                                        eyebrows converge onto the ratified Eyebrow role of the
                                        Caption rung — 12 / 700 / uppercase / tracking — by GAINING
                                        `font-bold`. They shipped at weight 400.

                                        THE PLAN SAID "match a named shipped eyebrow byte-for-byte";
                                        that is not achievable and would be wrong. Measured
                                        2026-09-16, the three shipped eyebrows
                                        (CalendarListView.js:823, RsvpSection.js:285,
                                        NextGameNightCard.tsx:309) are all `font-semibold` (600) and
                                        disagree on tracking — `tracking-wide`, `tracking-wider`,
                                        `tracking-[0.08em]`. §4.5 ratifies 700 and §4.2 gives 600
                                        exactly one home, the Button primitive, so copying any of
                                        them would import a prohibited weight; their own sweeps move
                                        them to 700 later. TRACKING is matched to
                                        CalendarListView.js:823's `tracking-wide`, which is also the
                                        value these two already carried, so no tracking changes here.

                                        NOT a `Heading`: these are `<span>`s inside a divider rule,
                                        not heading tags, and P4 forbids inventing a level. There is
                                        deliberately no `eyebrow` variant on the primitive
                                        (Heading.tsx:17-18) — uppercase, tracking and colour ride on
                                        `className`. */}
                                    <span className="text-xs font-bold text-content-muted uppercase tracking-wide">or</span>
                                    <div className="flex-1 border-t border-line" />
                                </div>
                            </div>

                            {/* QR Code section */}
                            <div className="p-5">
                                <Heading level={3} size="label" className="text-content-muted uppercase tracking-wide mb-3">
                                    Share QR Code
                                </Heading>
                                {tokenLoading ? (
                                    <div role="status" aria-label="Loading QR code" className="flex items-center gap-2 text-content-muted py-6 justify-center">
                                        <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
                                        <span>Loading QR code...</span>
                                    </div>
                                ) : inviteUrl ? (
                                    <div className="flex flex-col items-center">
                                        <QRCodeSVG value={inviteUrl} size={160} level="M" marginSize={2} />
                                        <p className="text-xs text-content-muted mt-2 text-center">
                                            Scan to join group
                                        </p>
                                        <Button
                                            variant="primary"
                                            size="default"
                                            onClick={handleCopyLink}
                                            className="mt-3 w-full"
                                        >
                                            {copied ? 'Copied!' : 'Copy Invite Link'}
                                        </Button>
                                        {/* DECISION Phase 88.6-22 (R3 #148 / r2 #182): the copy
                                            success gets an ANNOUNCEMENT, and the visible label swap
                                            is KEPT exactly as it ships. The only feedback today is
                                            that swap, and a label change on the element the user is
                                            focused on does not announce — UI-SPEC §7.3 states this
                                            for the KebabMenu armed state and the mechanism is
                                            identical here.

                                            `sr-only` deliberately: the sighted feedback already
                                            exists on the button. REJECTED — a visible region, which
                                            would print "Invite link copied" underneath a button that
                                            already reads "Copied!", i.e. the same fact twice; and
                                            REJECTED — leaving it to the label swap, which is the
                                            silent-success outcome this pass exists to close. */}
                                        <StatusRegion
                                            className="sr-only"
                                            message={copied ? 'Invite link copied to the clipboard.' : ''}
                                        />
                                        {/* Reset invite link — admin-only per Phase 69 CONTEXT D-INV-02.
                                            Rendered (not just disabled) only for owner/admin so non-admins
                                            don't see the button at all. */}
                                        {isAdmin && (
                                            <Button
                                                variant="secondary"
                                                size="default"
                                                onClick={handleResetInviteLink}
                                                aria-disabled={resetting ? 'true' : undefined}
                                                className="mt-2 w-full text-content-status-error"
                                                title="Invalidate the current invite link and generate a new one"
                                            >
                                                {resetting ? 'Resetting…' : 'Reset invite link'}
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-content-muted text-sm text-center py-4">
                                        Unable to generate QR code
                                    </p>
                                )}
                            </div>
                        </>
                    )}
        </>
    );

    /* DECISION Phase 88-15 (SPEC Req 9): this panel is hosted on the shared
       <Modal> primitive, and its old bespoke backdrop/panel tiers (a hand-rolled
       `fixed inset-0 bg-black/50` backdrop one step above `.modal-overlay`, plus
       a slide-in sheet one step above that) are NOT re-created as custom z-index
       classes on the Radix content.

       This component was the twelfth bespoke modal and the one the Req 9
       `.modal-overlay` class census structurally CANNOT see — it was bespoke via
       its own backdrop, not the shared class — which is why the migration is
       proven by explicit dialog-role / Esc / focus-trap pins in
       FriendInvitePanel.test.tsx rather than by the grep gate.

       RESOLVED STACKING ORDER (verified, not assumed — this panel deliberately
       sits ABOVE other overlays and BELOW the tooltip tier):
         - `.modal-overlay` is `z-index: 50` and renders inside the React tree
           (globals.css:1075-1078). ManageMembers.js:645 opens this panel as a
           sibling of that overlay, and grouplist/userHome open it standalone.
         - Radix portals this dialog to the END of <body>, so at an equal
           z-index 50 it still paints above `.modal-overlay` purely by DOM order.
           The stacking relationship the old bespoke value bought is therefore
           preserved structurally, without a bespoke tier.
         - HeatmapTooltip.js:334-340 pins tooltips at z-index 100 as "always
           topmost" (a shipped Plan 72-02 UAT decision). That tier is untouched
           and still clears this dialog.

       The rejected alternative was porting the old numbers onto <Modal> via
       `className`: it re-introduces a bespoke tier the rest of the modal fleet
       does not have, and it is unnecessary because the portal already resolves
       the order. Changing this is a decision, not a cleanup.

       The right-hand slide-in sheet chrome is deliberately replaced by the
       fleet's centered dialog chrome (the panel keeps its `max-w-md` width).
       Reverting to a sheet is a decision, not a cleanup. */
    return (
        <Modal open={open} onClose={onClose} className="max-w-md">
            {/* Freeform header (the QRCodeModal idiom): <Modal.Header> renders a
                single-line DialogTitle, and this panel's header is a two-line
                stack. The chrome mirrors <Modal.Header> 1:1 so it matches the
                fleet, and the title is still the DialogTitle so Radix keeps
                auto-wiring `aria-labelledby`. */}
            <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
                <div className="min-w-0">
                    <DialogTitle className="text-xl font-bold text-content-primary">
                        {headerTitle}
                    </DialogTitle>
                    {headerLeadIn && (
                        <p className="text-sm text-content-muted mt-0.5">{headerLeadIn}</p>
                    )}
                </div>
                {/* 88-CODE-REVIEW D1 (2026-08-06): same 44px real-box fix as Modal.tsx's
                    ModalHeader DialogClose — this is the one freeform copy of that idiom. */}
                <DialogClose
                    aria-label="Close"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center shrink-0 text-2xl leading-none text-content-muted transition-colors hover:text-content-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                    &times;
                </DialogClose>
            </div>

            {/* p-0: every body section below carries its own `p-5`. */}
            <Modal.Body className="p-0 md:p-0">{body}</Modal.Body>

            <Modal.Footer>
                <Modal.Action
                    variant="secondary"
                    onClick={onClose}
                    className="w-full py-2.5"
                >
                    Done
                </Modal.Action>
            </Modal.Footer>
        </Modal>
    );
}

export default FriendInvitePanel;
