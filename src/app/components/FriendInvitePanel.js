'use client';
import { useState, useEffect, useRef } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, invitesAPI, groupsAPI } from '../../lib/api';
import { QRCodeSVG } from 'qrcode.react';
import { UserChip } from '@/components/ui/UserChip';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { DialogClose, DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { useFriendshipStatus } from './FriendshipStatusProvider';
import { logger, errCtx } from '@/lib/logger';
import {
    isAlreadyInvitedOrMember,
    ALL_ALREADY_INVITED_MESSAGE,
    invitedWithAlreadyMessage,
    allFailedBatchLine,
} from './friendBatchInviteOutcome';

// UI-SPEC §6.3 row "FriendInvitePanel.js email-invite `validation` override" — ratified
// 2026-09-28 (`H3-COPY-RULING`). Declared once; byte-equal to the §6.3 row.
const INVALID_EMAIL_MESSAGE = "That doesn't look like a valid email address. Check it and try again.";
// Copy row G2 (88.6.1-COPY-TABLE.html, ratified 2026-10-04; D-30 site constant, D-32 R8 ASCII apostrophe).
const INVITE_SEND_FAILED_MESSAGE = "We couldn't send that invite. Please try again.";
// Copy row X3, reused at Add Friend by the owner's ruling of 2026-10-05 (D-47; D-32 R8 ASCII
// apostrophe). Plan 88.6.1-37 hoists the same row as SEND_REQUEST_FAILED_MESSAGE at the member
// plus button: two site constants by D-30's placement rule, not a shared module.
const FRIEND_REQUEST_FAILED_MESSAGE = "We couldn't send that request.";
// The copy confirmation (copy row G3's sentence, byte-identical to the literal this panel
// shipped; the QR dialog hoists the same constant, plan 88.6.1-12).
const LINK_COPIED_ANNOUNCEMENT = 'Invite link copied to the clipboard.';
// How long the visible label reads Copied! after a successful copy.
const COPIED_LABEL_MS = 2000;
// Copy ruling CR-1 (88.6.1 code review A-25, owner ratified 2026-10-19; D-30 placement rule: a
// hoisted constant at the site; D-32 R8 straight apostrophe). Byte-identical to the QR dialog's
// constant of the same name (its twin).
const COPY_FAILED_MESSAGE = "Couldn't copy the link. Press and hold the link to copy it.";

// `openedFrom` is the entry point this panel was opened from: 'create' is the
// auto-open immediately after a group is created (createGroup.js) and swaps in
// the context copy of UI-SPEC §6.3; every other entry point keeps the generic
// header. Deliberately a plain comment, NOT a JSDoc `@param` block — under
// checkJs a partial @param list becomes the component's whole props type and
// every other prop then fails to typecheck at the call sites.
function FriendInvitePanel({ group, open, onClose, onMemberAdded, openedFrom = 'default' }) {
    const { user } = useUser();
    // FE-18 cutover: exclude-self keys on the resolved Users.id UUID (async).
    const { selfUuid } = useSelfIdentity();
    // 88.6.1 code review A-17: Add Friend sends through the app-wide provider (see handleAddFriend).
    const { sendRequest: sendFriendRequest } = useFriendshipStatus();

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
    // The send lane (88.6.1-27): failures about the SEND action, never about the typed address.
    const [sendError, setSendError] = useState('');
    const [emailSuccess, setEmailSuccess] = useState('');

    // Add friend prompt state
    const [friendPrompt, setFriendPrompt] = useState(null); // { id, username, email } — id is the Users.id UUID
    const [addingFriend, setAddingFriend] = useState(false);
    const [friendRequestSent, setFriendRequestSent] = useState(false);
    // Add Friend's failure lane (88.6.1-27): every failure except the already-pending answer.
    const [friendRequestError, setFriendRequestError] = useState('');

    // QR code invite state
    const [inviteUrl, setInviteUrl] = useState(null);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    // Bumped once per successful copy; keys the announcement text so a repeat copy re-announces.
    const [copySeq, setCopySeq] = useState(0);
    // CR-1 / A-25: a refused clipboard write; the sequence keys the sentence so a repeat failure
    // re-announces (the copySeq idiom).
    const [copyFailed, setCopyFailed] = useState(false);
    const [failSeq, setFailSeq] = useState(0);

    /* DECISION Phase 88.6-22 (R3 #149, the rule of KIND + the rule of POSITION): every gated
       BUTTON on this surface carries `aria-disabled` plus a SYNCHRONOUS first-line ref latch
       released in a `finally` — chosen OVER the native `disabled` attribute it shipped with.

       THE RULE, as plans 17 and 18 state it identically (planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-17-PLAN.md ("Rule of kind (stated identically in plans 17 and 18)"),
       planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-18-PLAN.md ("The composed rule, stated identically in plan 17")). In-flight/busy gates normally KEEP native `disabled` — they are
       WCAG-exempt and the `.btn:disabled` wash is the right treatment. The rule of POSITION is
       the addition: an in-flight gate keeps native `disabled` EXCEPT on the control the user
       just activated, where `DECISION Phase 88.5`'s idiom applies instead — a natively disabled
       element leaves the focus order, so a keyboard or switch user is stranded mid-submit
       (src/app/components/NextGameNightCard.tsx ("A natively-disabled element is removed from the focus order") spells this out, its `removed from the focus order` marker). All four gated buttons here sit on the
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
       `.btn:disabled { opacity: .5 }` (src/app/globals.css (".btn:disabled { opacity: .5 }")) and now takes the
       DR-C gated COLOUR pair (src/app/globals.css (".btn-primary[aria-disabled='true'] {"),
       src/app/globals.css (".btn-secondary[aria-disabled='true'] {")). Fill and ink swap instead of the whole control washing out.

       Dropping either half of any pair, or restoring the native attribute, is a decision, not
       a cleanup.

       AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (D-35, W016 row 17; W015): the
       count of gated buttons on this surface is now THREE (bulk invite, Send, Add Friend). The
       fourth, the admin invite-link reset, was deleted under W015 (see the marker in the QR
       section). And the email field no longer stays native while sending: the form submits on
       Enter FROM the field (Send is the submit button), so on a phone keyboard's Go key the
       field IS the control just activated, and native disabling drops focus (CT-3 row 17). It
       is read-only and aria-disabled instead; a second Enter reaches handleEmailInvite, whose
       first line is the in-flight refusal. VISIBLE DELTA, disclosed: the field no longer dims
       while sending. No gated look is added to it, chosen OVER an opacity utility on the gated
       state (the 88.8 colour-not-opacity rule; tokenContrast.test.ts test 53, the line
       "no aria-disabled rule uses opacity") and OVER muted ink on the input ground (an
       ink/ground pair no gate measures in dark mode — a look decision for Phase 88.9). The Send
       button's Sending... label and gated colour pair carry the in-flight state. The friend
       checkbox stays the rule-of-KIND example: a state gate on a control nobody pressed. The
       paragraphs above are kept as history. */
    const bulkInviteInFlightRef = useRef(false);
    const emailInviteInFlightRef = useRef(false);
    const addFriendInFlightRef = useRef(false);

    // The copy label's 2 s handle; see the copy-announcement marker in the QR section.
    const copiedTimerRef = useRef(null);
    // CR-1 / A-25: bumped on every close, so a clipboard rejection that settles after the panel
    // closed shows nothing on a reopen (the QR dialog's generation guard).
    const openGenerationRef = useRef(0);

    // The Req 5 recovery target when Add Friend's prompt unmounts with the focused button.
    const inviteByEmailHeadingRef = useRef(null);
    const addFriendRecovery = useFocusRecovery({ fallback: inviteByEmailHeadingRef });

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
            setSendError('');
            setEmailSuccess('');
            setFriendPrompt(null);
            setFriendRequestSent(false);
            setFriendRequestError('');
            setInviteUrl(null);
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = null;
            setCopied(false);
            openGenerationRef.current += 1;
            setCopyFailed(false);
        }
    }, [open]);

    // The copy label's timer never outlives the panel.
    useEffect(
        () => () => {
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        },
        []
    );

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
        //
        // AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (Req 8; D-22; D-32 R2): the
        // all-failed branch now passes a fallback, R2 (now in ./friendBatchInviteOutcome with this rule, 88.6.1-90), so a
        // code-less first failure no longer reads the register's unknown line
        // (which told the user to refresh the page); a coded first failure keeps its register
        // line. The friends page twin already ships the same sentence. Where the outcome is
        // shown and heard is recorded at the result regions in the bulk block.
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
                    // The terminal-409 rule and its contract (Wave-12 review MED #9) live in ./friendBatchInviteOutcome (88.6.1-72).
                    if (isAlreadyInvitedOrMember(err)) {
                        alreadyCount++;
                    } else {
                        failCount++;
                        if (!firstFailure) firstFailure = err;
                        logger.info('Error sending friend invite:', errCtx(err));
                    }
                }
            }

            setInviteResult({ successCount, failCount, alreadyCount, firstFailure });
            setSelectedFriends(new Set());

            if (successCount > 0 && onMemberAdded) {
                onMemberAdded();
            }
        } finally {
            // Released in `finally` so a FAILED pass does not strand the control. The in-flight label and its
            // aria-disabled are released here too (88.6.1 code review IN-07): the two halves of one gate on one path.
            setInviting(false);
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
            setSendError('');
            setEmailError('Enter an email address to send an invite.');
            return;
        }

        const invitedEmail = email.trim();
        emailInviteInFlightRef.current = true;
        setEmailLoading(true);
        setEmailError('');
        setSendError('');
        setEmailSuccess('');
        setFriendPrompt(null);
        setFriendRequestSent(false);
        setFriendRequestError('');

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
                   (src/components/ui/useFetchErrorState.ts ("already_member: 'This person"), src/components/ui/useFetchErrorState.ts ("invite_pending: 'This person") — re-pointed
                   2026-10-15 from :88 / :91), so keeping them costs nothing and preserves the
                   surface-owns-its-richer-resting-copy precedence that file records at
                   src/components/ui/useFetchErrorState.ts ("richer 'Invite pending' / 'Already a member' resting states take precedence"). Collapsing them into the helper is
                   a decision, not a cleanup.

                   AMENDED IN PLACE 2026-09-28 — DECISION Phase 88.6-58 (review H3 + cross-finding
                   4, owner rulings `H3-RULING` / `H3-COPY-RULING`): the else arm STILL passes no
                   `fallback` (a code-less failure still resolves `unknown`), but `validation` is
                   overridden LOCALLY with the §6.3-ratified INVALID_EMAIL_MESSAGE. Why that is
                   safe on THIS call: every code-less 400 reachable from
                   `invitesAPI.sendInvite(group_id, email)` is the server's `isEmail` verdict
                   (Sonnet/routes/invites.js, raw `{ errors }`) — measured
                   2026-09-28: the selector-count 400s cannot fire because the empty
                   field is refused above first; the self-invite 400s sit on branches this call
                   never takes; `group_id` is app-supplied. Any NEW raw 400 on the email path must
                   land as `sendError` with its OWN code (Phase 93's rule, entry "(f) TELLING THAT
                   ROUTE'S THREE 400 OUTCOMES APART NEEDS A BACKEND `code`", parent-repo
                   .planning/deferred/phase-93.md as of 2026-09-28) — never widen this
                   override. REJECTED: editing `MESSAGE_BY_CODE.validation` globally (shared
                   register; 11 other non-test `byCode:` override sites at d03f728, git grep
                   2026-09-28), and a client-side format regex (a hand-written
                   pattern stricter than `isEmail` refuses addresses the server accepts, with no
                   way around it — the server stays the single source of truth).

                   AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (copy row G2, D-30; the
                   lane rule of D-11a): (1) the arm now passes a `fallback`, G2. "No fallback"
                   rested on there being no ratified line for this action; D-30 ratified one. The
                   register's unknown line told the user to refresh the page, which throws away the
                   address they typed. (2) Only `validation` writes the FIELD lane: together with the
                   two code arms above, the field lane holds verdicts about the ADDRESS TYPED. Every
                   other failure is about the SEND and goes to the send lane, which the Send button
                   names in its description, so the field is not announced as invalid. (3) REJECTED:
                   one shared region with the invalid flag merely dropped for non-field codes (that
                   region's id is the field's description target and would carry action failures);
                   moving the two 409 arms to the send lane (they are fixed by changing the address,
                   and 88.6-22 keeps them deliberately); a toast (not tied to the control, and gone
                   before a screen reader reaches it). (4) Once plan 88.6.1-07's CSRF predicate
                   lands, a blocked send resolves through the unknown code and reads G2 too.
                   Changing any of this is a decision, not a cleanup. */
                const message = getFetchErrorMessage(err, {
                    byCode: { validation: INVALID_EMAIL_MESSAGE },
                    fallback: INVITE_SEND_FAILED_MESSAGE,
                });
                if (code === 'validation') {
                    setEmailError(message);
                } else {
                    setSendError(message);
                }
            }
        } finally {
            setEmailLoading(false);
            // Released in `finally` so a FAILED send does not strand the control.
            emailInviteInFlightRef.current = false;
        }
    };

    const handleAddFriend = async (event) => {
        // The in-flight refusal, synchronous and FIRST — see the latch marker above. There was
        // NO in-flight guard here before: the shipped `disabled={addingFriend}` was the only
        // thing stopping a second press, so moving it to `aria-disabled` without this latch
        // would have made the control re-submittable.
        if (addFriendInFlightRef.current) return;
        if (!friendPrompt?.id) return;
        addFriendInFlightRef.current = true;
        /* DECISION Phase 88.6.1-27 (Req 5, D-04/D-05): when the request settles as sent, the
           prompt block unmounts together with the focused Add Friend button, and focus used to
           fall to the dialog container. The recovery is armed here, synchronously and before any
           await, and settled in the finally below; its target is the "Invite by Email" section
           heading, chosen OVER the email field (focus into a field raises the phone keyboard
           unasked), the friend-request line (focusing a live region speaks it twice) and the
           dialog title (further from where the user stood). No heading is minted — this one
           already exists. A programmatic focus may draw the browser's ring on the heading
           (RESEARCH P-11); the shipped recovery targets do the same. Changing this is a
           decision, not a cleanup.
           AMENDED 2026-10-19 (88.6.1 code review A-16 / WR-05): armed `from` the pressed button, per the
           hook's consumer contract (1) — a WebKit tap does not focus it, and an arm seeded from
           document.activeElement then watched nothing, so the hand-off never happened on iOS Safari. */
        const settle = addFriendRecovery.arm({ from: event?.currentTarget ?? null });
        setAddingFriend(true);
        // Emptied at every attempt, so a repeat failure is a change the lane announces again.
        setFriendRequestError('');
        try {
            // DECISION 88.6.1 code review A-17: sent through the provider's send-and-sync (FriendshipStatusProvider's
            // sendRequestAndSync), CHOSEN OVER the raw friendshipsAPI.sendRequest this site used to call, which left the
            // provider's sentRequests without the new request, so member chips and name popovers app-wide kept offering
            // + add friend (plan 88.6.1-66's rule: every confirmed list edit starts a load). The provider resolves its
            // 409 (already pending / already friends) like a success, which lands on the same sent line the conflict arm
            // below shows; that arm stays as the backstop for a conflict that reaches here. Going back to the raw call
            // is a decision, not a cleanup.
            await sendFriendRequest(friendPrompt.id);
            setFriendRequestSent(true);
        } catch (err) {
            // Silently fail — they may already have a pending request
            //
            // AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (copy row X3 reuse, owner ruling 2026-10-05; SPEC Prohibition 2):
            // (1) KEPT — the already-pending answer still shows "Friend request sent!" (the
            // owner's ruling: that deliberate case stays). (2) CHANGED — every other failure shows
            // X3 from the friend-request error lane, which Add Friend names in its description,
            // and the prompt stays so Add Friend can be pressed again; before this, every failure
            // claimed success. (3) HOW THE CASES ARE TOLD APART — the request route answers a
            // pending request in either direction and an existing friendship with two 409s that
            // carry no error code, so the API client maps both to conflict from the status alone,
            // and conflict is the only signal this site reads. The existing-friendship answer
            // therefore also keeps the success line; it reaches this button only when the
            // friends list failed to load or went stale, because the prompt is skipped for a
            // known friend. Splitting it needs a registered error code from the backend (Phase
            // 93's conversion of the raw-error routes), and when one lands this branch changes in
            // the same commit or the pending answer silently falls to X3. (4) REJECTED — X3 for
            // every failure (it would tell someone whose request is already waiting that it
            // failed, against the ruling); branching on the backend's error text (the prose
            // fallback the email catch above removed on 2026-08-21, and a read the
            // error-envelope roster suite forbids); unmounting the prompt on failure (it strands
            // the retry and drops focus); writing the failure into the email send lane (that
            // lane describes the Send button, a different action). Only the error's code is
            // read here. Changing any of this is a decision, not a cleanup.
            // AMENDED 2026-10-19 (88.6.1 code review A-17): the send now goes through the provider, whose
            // handleSendRequest resolves a 409 before it reaches this catch; the outcome is the same sent line
            // (point (1) and (3) unchanged), and this conflict arm stays as the backstop.
            if (err?.code === 'conflict') {
                setFriendRequestSent(true);
            } else {
                setFriendRequestError(FRIEND_REQUEST_FAILED_MESSAGE);
            }
        } finally {
            setAddingFriend(false);
            addFriendInFlightRef.current = false;
            settle();
        }
    };

    const handleCopyLink = async () => {
        if (!inviteUrl) return;
        const generation = openGenerationRef.current;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            // 88.6.1 code review (F1 note under CR-1 / A-25, 2026-10-19): a resolution that settles after the close
            // sets nothing either — the same generation guard QRCodeModal.js carries on its success arm.
            if (openGenerationRef.current !== generation) return;
            setCopyFailed(false);
            setCopied(true);
            setCopySeq((n) => n + 1);
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = setTimeout(() => {
                copiedTimerRef.current = null;
                setCopied(false);
            }, COPIED_LABEL_MS);
        } catch (err) {
            logger.info('Failed to copy link:', errCtx(err));
            // CR-1 / A-25: a rejection that settles after the close sets nothing.
            if (openGenerationRef.current !== generation) return;
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = null;
            setCopied(false);
            setCopyFailed(true);
            setFailSeq((n) => n + 1);
        }
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

    // The friend batch's outcome, split between the two result regions in the bulk block (see
    // the marker there): the all-failed outcome is the alert region's, every other outcome the
    // polite region's. The sentences are the block's own, byte-for-byte.
    let batchStatusText = '';
    let batchErrorText = '';
    if (inviteResult) {
        if (inviteResult.failCount > 0 && inviteResult.successCount === 0) {
            batchErrorText = allFailedBatchLine(inviteResult.firstFailure);
        } else {
            batchStatusText = inviteResult.failCount === 0
                ? (inviteResult.alreadyCount > 0
                    ? (inviteResult.successCount > 0
                        ? invitedWithAlreadyMessage(inviteResult.successCount, inviteResult.alreadyCount)
                        : ALL_ALREADY_INVITED_MESSAGE)
                    : `Invited ${inviteResult.successCount} friend${inviteResult.successCount !== 1 ? 's' : ''}!`)
                : `Invited ${inviteResult.successCount}, ${inviteResult.failCount} failed`;
        }
    }

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

                                {/* DECISION Phase 88-27 (D-32 buckets A/B): only the first branch
                                       is a censused tint row. The other two were converged anyway,
                                       chosen OVER touching just the censused one — that would have
                                       left `bg-amber-50 text-amber-700 border-amber-200` and
                                       `bg-red-50 …` beside a token-based sibling, and those raw
                                       literals are light-only values on a card that flips to
                                       `#232d3e`, so they were already wrong in dark mode. The
                                       IDENTICAL bulk-invite result block, the friends page's batch result regions (id
                                       friends-batch-status; re-anchored 88.6.1-72),
                                       already uses status tokens on all three branches, so this
                                       converges the outlier onto shipped precedent rather than
                                       inventing a treatment. Reverting to raw palette is a
                                       decision, not a cleanup.

                                       AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (Req 8; D-22; D-32 R2):
                                       the result block was a conditionally mounted block with no
                                       role, so a screen-reader user who pressed Invite heard no
                                       outcome at all. It is now TWO regions mounted empty with the
                                       bulk block and hidden while empty (the D-22 house shape): a
                                       polite region for the all-succeeded, already-invited and
                                       partial outcomes, and an alert region for the all-failed one.
                                       Chosen OVER one polite region for every outcome (a total
                                       failure would queue behind other speech, and the email lane
                                       on this same panel is assertive) and OVER the alert role for
                                       all of them (a success is not an alert). The words are the
                                       block's own and nothing new is heard (D-31); the tint per
                                       branch is unchanged (88-27 stands). A code-less all-failed
                                       batch now says R2 (the friends page twin already does); a
                                       coded one keeps its register line. Changing this is a
                                       decision, not a cleanup. */}
                                {/* UI-SPEC §4.5, the EMPHASIS outcome: `font-medium` deleted;
                                    all three branches already carry a status colour token. */}
                                <StatusRegion
                                    id="invite-batch-status"
                                    srOnlyWhenEmpty
                                    message={batchStatusText}
                                    className={batchStatusText
                                        ? `mt-2 p-3 rounded-lg text-sm ${inviteResult.failCount === 0
                                            ? 'bg-status-success-subtle text-content-status-success border border-status-success'
                                            : 'bg-status-warning-subtle text-content-status-warning border border-status-warning'}`
                                        : 'mt-2'}
                                />
                                <StatusRegion
                                    id="invite-batch-error"
                                    politeness="assertive"
                                    srOnlyWhenEmpty
                                    message={batchErrorText}
                                    className={batchErrorText
                                        ? 'mt-2 p-3 rounded-lg text-sm bg-status-error-subtle text-content-status-error border border-status-error'
                                        : 'mt-2'}
                                />
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="px-5">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 border-t border-line" />
                            {/* UI-SPEC §4.5 Eyebrow role (D-03): Caption 12 / 700 / uppercase /
                                tracking. `font-bold` ADDED; `tracking-wide` is the spelling the
                                nearest shipped eyebrow uses (src/app/components/CalendarListView.js ("the ratified EYEBROW role (Caption 12 / 700 / uppercase / tracking)"), `uppercase tracking-wide`). See the
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
                            NOTHING for empty children (src/components/ui/Heading.tsx ("if (isEmptyChildren(children)) return null;")) and would take the `id`
                            with it. */}
                        <Heading
                            ref={inviteByEmailHeadingRef}
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
                            message again — a decision, not a cleanup.

                            AMENDED 2026-09-28 — DECISION Phase 88.6-58 (review H3, owner
                            rulings `H3-RULING` / `H3-COPY-RULING`): "returns through the
                            ratified register" was true but that register line was
                            `validation` = "…Refresh the page…", which cannot fix a typo. The
                            malformed address now gets the app-authored field message
                            (INVALID_EMAIL_MESSAGE, UI-SPEC §6.3, ratified 2026-09-28) via a local
                            `byCode` override in handleEmailInvite's else arm. A client-side
                            format regex was considered and REJECTED: the server's `isEmail`
                            stays the single source of truth. */}
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
                                    setSendError('');
                                    setEmailSuccess('');
                                }}
                                placeholder="user@example.com"
                                required
                                aria-invalid={emailError ? 'true' : undefined}
                                aria-describedby={emailError ? 'invite-email-error' : undefined}
                                readOnly={emailLoading}
                                aria-disabled={emailLoading ? 'true' : undefined}
                                className="flex-1"
                            />
                            <Button
                                variant="primary"
                                size="default"
                                type="submit"
                                aria-disabled={emailLoading || !email.trim() ? 'true' : undefined}
                                aria-describedby={sendError ? 'invite-email-send-error' : undefined}
                                className="shrink-0"
                            >
                                {emailLoading ? 'Sending...' : 'Send'}
                            </Button>
                        </form>
                        {/* DECISION Phase 88.6-22 (R2 #177): this is a real FIELD error on the
                            email input, so it takes `politeness="assertive"` — `role="alert"` +
                            `aria-live="assertive"` (src/components/ui/StatusRegion.tsx ("role={assertive ? 'alert' : 'status'}")) — and spells its id,
                            its `aria-describedby` and its `aria-invalid` flip the way the shipped
                            field-error primitive does (src/app/components/form/FormField.tsx ("const errorId =") `${controlId}-error`, src/app/components/form/FormField.tsx ("'aria-describedby'?: string;")
                            and src/app/components/form/FormField.tsx ("const describedBy =") the composed describedby, src/app/components/form/FormField.tsx ("'aria-invalid': error ? 'true' : undefined,") aria-invalid, src/app/components/form/FormField.tsx ("DECISION Phase 88.6.1-15 (D-42, ST-1 #9)") role=alert;
                            re-pointed 2026-10-15).
                            That makes this the SECOND spelling of the field error in the phase,
                            never a third.

                            REJECTED — adopting `FormField` itself, which on the merits is the
                            better home since it supplies all three attributes. Its `label` prop is
                            REQUIRED and always renders a visible `<label>` (src/app/components/form/FormField.tsx ("<label")),
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
                            on `className` because src/components/ui/StatusRegion.tsx ("className={cn(") is `cn('text-sm', className, …)`.
                            `text-red-500` (#ef4444) measured 3.76:1 on --color-bg-card (#ffffff),
                            below the 4.5:1 AA floor; `text-content-status-error`
                            (--color-status-error-text #991b1b, src/app/globals.css ("--color-status-error-text: #991b1b")) measures 8.31:1.

                            AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (D-22, D-42):
                            (1) D-42 — "a screen reader announces a CHANGE to a live region, not the
                            conditional mount of a new one" holds for polite regions; an alert region
                            that arrives with its text is announced too. This region stays
                            always-mounted for node identity and the one house shape, not because an
                            insertion would be silent. (2) D-22 — the "margin only when filled"
                            paragraph above is superseded: the region carries the house empty shape
                            (the srOnlyWhenEmpty prop), so its mt-2 is unconditional and an empty
                            region is out of flow — no idle space, the same 8px when it shows. Its
                            sibling directly below is the send lane, which holds failures about the
                            SEND action (see the else-arm marker in handleEmailInvite). */}
                        <StatusRegion
                            id="invite-email-error"
                            politeness="assertive"
                            srOnlyWhenEmpty
                            message={emailError}
                            className="mt-2 text-content-status-error"
                        />
                        <StatusRegion
                            id="invite-email-send-error"
                            politeness="assertive"
                            srOnlyWhenEmpty
                            message={sendError}
                            className="mt-2 text-content-status-error"
                        />
                        {/* R3 #148 / r2 #182: the SUCCESS announced too. A surface that announces
                            every failure and no success tells a screen-reader user the invite
                            failed silently. Polite, and a separate region from the assertive error
                            one — UI-SPEC §6.2's "exactly one live region per FAILURE" is not
                            breached by a success region (the A-31 precedent). */}
                        <StatusRegion
                            id="invite-email-status"
                            srOnlyWhenEmpty
                            message={emailSuccess}
                            className="mt-2 text-content-status-success"
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
                                    aria-describedby={friendRequestError ? 'invite-friend-request-error' : undefined}
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
                            srOnlyWhenEmpty
                            message={friendRequestSent ? 'Friend request sent!' : ''}
                            className="mt-2 text-content-status-success"
                        />
                        <StatusRegion
                            id="invite-friend-request-error"
                            politeness="assertive"
                            srOnlyWhenEmpty
                            message={friendRequestError}
                            className="mt-2 text-content-status-error"
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
                                        (CalendarListView.js, RsvpSection.js,
                                        NextGameNightCard.tsx as of that date; on 2026-10-15
                                        they sit at CalendarListView.js, RsvpSection.js and
                                        NextGameNightCard.tsx, each now at 700) are all `font-semibold` (600) and
                                        disagree on tracking — `tracking-wide`, `tracking-wider`,
                                        `tracking-[0.08em]`. §4.5 ratifies 700 and §4.2 gives 600
                                        exactly one home, the Button primitive, so copying any of
                                        them would import a prohibited weight; their own sweeps move
                                        them to 700 later. TRACKING is matched to
                                        the `tracking-wide` of src/app/components/CalendarListView.js ("the ratified EYEBROW role (Caption 12 / 700 / uppercase / tracking)"), which is also the
                                        value these two already carried, so no tracking changes here.

                                        NOT a `Heading`: these are `<span>`s inside a divider rule,
                                        not heading tags, and P4 forbids inventing a level. There is
                                        deliberately no `eyebrow` variant on the primitive
                                        (src/components/ui/Heading.tsx ("That would mint a fifth type role")) — uppercase, tracking and colour ride on
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
                                            silent-success outcome this pass exists to close.

                                            AMENDED IN PLACE 2026-10-15 — DECISION Phase 88.6.1-27 (Req 8 R8; Req 11):
                                            a repeat copy is announced again — the sentence sits in a
                                            span keyed on a per-copy sequence, so each copy is a new
                                            text node — chosen OVER clearing the
                                            state at the start of the handler (it would flash the
                                            focused button's label back during the write). The 2 s
                                            label handle is held in a ref and cleared on re-arm, close
                                            and unmount, chosen OVER unmount-only cleanup (all three
                                            hosts keep the panel mounted while closed, so close is the
                                            common exit). The shape is the QR dialog's (plan
                                            88.6.1-12), so the app has one copy idiom. The region stays
                                            sr-only for its whole life and does not take the D-22
                                            prop. Changing any of this is a decision, not a cleanup. */}
                                        <StatusRegion
                                            id="invite-link-copied-status"
                                            className="sr-only"
                                        >
                                            <span key={copySeq}>{copied ? LINK_COPIED_ANNOUNCEMENT : ''}</span>
                                        </StatusRegion>
                                        {/* DECISION Phase 88.6.1 code review CR-1 / A-25 (owner ratified
                                            2026-10-19): a refused clipboard write is SHOWN and ANNOUNCED
                                            from a SECOND polite region in the house empty shape
                                            (srOnlyWhenEmpty), chosen OVER reusing the sr-only success
                                            region above, which stays sr-only for its whole life because a
                                            visible success would repeat the button's Copied! label; a
                                            failure has no such twin. This section otherwise shows only the
                                            QR code, and the sentence says to press and hold THE LINK, so
                                            in the failure state the URL is rendered as a plain link under
                                            the sentence, outside the atomic region (data, not copy).
                                            Cleared by the next successful copy and on close; a rejection
                                            that settles after the close sets nothing. The shape is the QR
                                            dialog's, so the app keeps one copy idiom. Changing any of this
                                            is a decision, not a cleanup. */}
                                        <StatusRegion
                                            id="invite-link-copy-failed-status"
                                            srOnlyWhenEmpty
                                            className="mt-2 w-full text-center text-content-status-error"
                                        >
                                            <span key={failSeq}>{copyFailed ? COPY_FAILED_MESSAGE : ''}</span>
                                        </StatusRegion>
                                        {copyFailed ? (
                                            <a
                                                href={inviteUrl}
                                                className="mt-1 block w-full text-center text-sm text-content-link underline break-all focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                                            >
                                                {inviteUrl}
                                            </a>
                                        ) : null}
                                        {/* DECISION Phase 88.6.1-27 (Req 14, W015, LATENT-AND-DEAD-RULING):
                                            this panel has no invite-link reset. The admin flag that
                                            gated one here was never passed by any of the three hosts,
                                            so the control, its two reset handlers, their in-flight
                                            latch and the toast library they used were dead code and
                                            were deleted. The working reset lives in Manage Members,
                                            behind its reset confirm gate (ManageMembers.js at the
                                            useConfirmAction call that builds it, on 2026-10-15),
                                            chosen OVER wiring this copy up: a second entry point is a
                                            product idea recorded as the todo
                                            2026-10-03-group-kebab-second-home-for-invite-link-reset.md.
                                            Re-adding a reset here is a decision, not a cleanup. */}
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
           (globals.css when written; Phase 88-31 deleted that rule — see its
           AMENDED BY PHASE 88-31 note in globals.css). src/app/components/ManageMembers.js ("<FriendInvitePanel") opens this panel as a
           sibling of that overlay, and grouplist/userHome open it standalone.
         - Radix portals this dialog to the END of <body>, so at an equal
           z-index 50 it still paints above `.modal-overlay` purely by DOM order.
           The stacking relationship the old bespoke value bought is therefore
           preserved structurally, without a bespoke tier.
         - src/app/components/HeatmapTooltip.js ("are always topmost — z-100 clears every existing overlay tier") (`zIndex: 100` at src/app/components/HeatmapTooltip.js ("style={{ ...floatingStyles, zIndex: 100 }}")) pins tooltips at z-index 100 as "always
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
            {/* Freeform header (the QRCodeModal idiom): the Modal header renders a
                single-line DialogTitle, and this panel's header is a two-line
                stack. The chrome mirrors the Modal header's phone-first scale
                (src/app/components/Modal.tsx ("function ModalHeader("), the class string carrying px-3 py-2 md:px-6 md:py-3)
                and its bottom border, except two things kept on purpose for the
                two-line title stack beside the 44px close: items-start (the close
                stays on the first line instead of centring on two) and gap-3 (the
                Modal header carries no gap). The title is still the DialogTitle so
                Radix keeps auto-wiring `aria-labelledby`.

                DECISION Phase 88.6.1-27 (R7-M5): this header shipped with fixed
                padding — 24px on each side and 20px top and bottom at every width —
                which made the text column 24px narrower at 375 than every other
                dialog header, exactly where a long group name wraps (UAT3-D2).
                It now takes the Modal header's scale: 12px sides and 8px top and
                bottom on a phone, 24px and 12px from the md breakpoint. Chosen OVER
                keeping the fixed padding with a recorded deviation. Measured in
                e2e/friend-invite-panel-header.spec.ts at both widths. Changing this
                is a decision, not a cleanup. */}
            <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2 md:px-6 md:py-3">
                {/* UAT3-D2 (owner device check 2026-09-30) + code review round 6: the user-supplied group
                    name lands in this column on EVERY entry point — in the title after creation
                    ("<name> is live — who's in?"), in the lead-in otherwise ("to <name>"). A 40-character
                    unbroken name overflowed the column and painted under the × beside it. `wrap-break-word`
                    sits on the COLUMN because overflow-wrap inherits — a class on the title alone left the
                    lead-in (a sibling) overflowing, which is what round 6 caught. Pinned for both paths in
                    FriendInvitePanel.test.tsx. */}
                <div className="min-w-0 wrap-break-word">
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
