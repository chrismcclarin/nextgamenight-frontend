'use client';
import { useState, useEffect } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, invitesAPI, groupsAPI } from '../../lib/api';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { UserChip } from '@/components/ui/UserChip';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { DialogClose, DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Input } from '@/components/ui/Input';

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
        if (!group?.id || selectedFriends.size === 0) return;
        setInviting(true);
        setInviteResult(null);

        let successCount = 0;
        let failCount = 0;

        for (const friendUserId of selectedFriends) {
            // Skip anyone already in the group; otherwise invite by user_id.
            // The friend's email is resolved server-side (83-06 PII default-deny).
            if (groupMemberIds.includes(friendUserId)) continue;
            try {
                await invitesAPI.sendFriendInvite(group.id, friendUserId);
                successCount++;
            } catch {
                failCount++;
            }
        }

        setInviteResult({ successCount, failCount });
        setSelectedFriends(new Set());
        setInviting(false);

        if (successCount > 0 && onMemberAdded) {
            onMemberAdded();
        }
    };

    const handleEmailInvite = async (e) => {
        e.preventDefault();
        if (!email.trim() || !group?.id) return;

        const invitedEmail = email.trim();
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
            const message = err.message || '';
            if (message.includes('already a member')) {
                setEmailError('This person is already a member of the group');
            } else if (message.includes('pending invite') || message.includes('already been invited')) {
                setEmailError('This person already has a pending invite');
            } else {
                setEmailError('Failed to send invite');
            }
        } finally {
            setEmailLoading(false);
        }
    };

    const handleAddFriend = async () => {
        if (!friendPrompt?.id) return;
        setAddingFriend(true);
        try {
            await friendshipsAPI.sendRequest(friendPrompt.id);
            setFriendRequestSent(true);
        } catch {
            // Silently fail — they may already have a pending request
            setFriendRequestSent(true);
        } finally {
            setAddingFriend(false);
        }
    };

    const handleCopyLink = async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy link:', err);
        }
    };

    // GUARD-02 G5: no blocking browser dialogs on a touched path. The
    // destructive reset is confirmed via a sonner toast action button, and
    // failures surface through toast.error (live-region backed) instead of a
    // blocking modal.
    const doResetInviteLink = async () => {
        if (!group?.id || resetting) return;
        setResetting(true);
        try {
            const data = await groupsAPI.resetInviteToken(group.id);
            setInviteUrl(data.invite_url);
            toast.success('Invite link reset. The old QR code and link no longer work.');
        } catch (err) {
            console.error('Failed to reset invite token:', err);
            toast.error(err.message || 'Failed to reset invite link. Please try again.');
        } finally {
            setResetting(false);
        }
    };

    const handleResetInviteLink = () => {
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
                        <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">
                            Your Friends
                        </h3>

                        {loadingFriends || loadingMembers ? (
                            <div className="flex items-center gap-2 text-content-muted py-6 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
                                <span>Loading...</span>
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
                                                        ? 'border-accent bg-surface-card-hover cursor-pointer'
                                                        : 'border-line hover:bg-surface-card-hover cursor-pointer'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isInGroup || selectedFriends.has(friend.id)}
                                                disabled={isInGroup}
                                                onChange={() => toggleFriend(friend.id)}
                                                className="h-4 w-4 rounded-sm border-line text-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:opacity-40"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-medium truncate ${isInGroup ? 'text-content-muted' : 'text-content-primary'}`}>
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
                                <button
                                    onClick={handleBulkInvite}
                                    disabled={selectedFriends.size === 0 || inviting}
                                    className="w-full btn btn-primary py-2.5 flex items-center justify-center gap-2"
                                >
                                    {inviting && (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    )}
                                    {inviting
                                        ? 'Sending...'
                                        : selectedFriends.size > 0
                                            ? `Invite ${selectedFriends.size} Friend${selectedFriends.size !== 1 ? 's' : ''}`
                                            : 'Select friends to invite'}
                                </button>

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
                                    <div className={`mt-2 p-3 rounded-lg text-sm font-medium ${
                                        inviteResult.failCount === 0
                                            ? 'bg-status-success-subtle text-status-success border border-status-success'
                                            : inviteResult.successCount > 0
                                                ? 'bg-status-warning-subtle text-status-warning border border-status-warning'
                                                : 'bg-status-error-subtle text-status-error border border-status-error'
                                    }`}>
                                        {inviteResult.failCount === 0
                                            ? `Invited ${inviteResult.successCount} friend${inviteResult.successCount !== 1 ? 's' : ''}!`
                                            : inviteResult.successCount > 0
                                                ? `Invited ${inviteResult.successCount}, ${inviteResult.failCount} failed`
                                                : 'Failed to send invites. Please try again.'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="px-5">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 border-t border-line" />
                            <span className="text-xs text-content-muted uppercase tracking-wide">or</span>
                            <div className="flex-1 border-t border-line" />
                        </div>
                    </div>

                    {/* Email invite section */}
                    <div className="p-5">
                        <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">
                            Invite by Email
                        </h3>
                        <form onSubmit={handleEmailInvite} className="flex gap-2">
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setEmailError('');
                                    setEmailSuccess('');
                                }}
                                placeholder="user@example.com"
                                required
                                disabled={emailLoading}
                                className="flex-1 disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={emailLoading || !email.trim()}
                                className="btn btn-primary text-sm py-2.5 shrink-0"
                            >
                                {emailLoading ? 'Sending...' : 'Send'}
                            </button>
                        </form>
                        {emailError && (
                            <p className="text-red-500 text-sm mt-2">{emailError}</p>
                        )}
                        {emailSuccess && (
                            <p className="text-status-success text-sm mt-2">{emailSuccess}</p>
                        )}
                        {friendPrompt && !friendRequestSent && (
                            <div className="mt-3 p-3 bg-surface-card-hover border border-line rounded-lg flex items-center justify-between gap-3">
                                {/* PRIM-04 adoption: render the resolved found-user identity
                                    via the shared UserChip primitive. */}
                                <div className="min-w-0">
                                    <UserChip
                                        user={{ name: friendPrompt.username || friendPrompt.email }}
                                        size="sm"
                                    />
                                    <p className="text-xs text-content-muted mt-0.5">Add as a friend?</p>
                                </div>
                                <button
                                    onClick={handleAddFriend}
                                    disabled={addingFriend}
                                    className="btn btn-primary text-xs px-3 py-1.5 shrink-0"
                                >
                                    {addingFriend ? 'Sending...' : 'Add Friend'}
                                </button>
                            </div>
                        )}
                        {friendRequestSent && (
                            <p className="text-status-success text-sm mt-2">Friend request sent!</p>
                        )}
                    </div>

                    {/* QR Code invite section -- only when group context exists */}
                    {group?.id && (
                        <>
                            {/* Divider */}
                            <div className="px-5">
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 border-t border-line" />
                                    <span className="text-xs text-content-muted uppercase tracking-wide">or</span>
                                    <div className="flex-1 border-t border-line" />
                                </div>
                            </div>

                            {/* QR Code section */}
                            <div className="p-5">
                                <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">
                                    Share QR Code
                                </h3>
                                {tokenLoading ? (
                                    <div className="flex items-center gap-2 text-content-muted py-6 justify-center">
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
                                        <span>Loading...</span>
                                    </div>
                                ) : inviteUrl ? (
                                    <div className="flex flex-col items-center">
                                        <QRCodeSVG value={inviteUrl} size={160} level="M" marginSize={2} />
                                        <p className="text-xs text-content-muted mt-2 text-center">
                                            Scan to join group
                                        </p>
                                        <button
                                            onClick={handleCopyLink}
                                            className="mt-3 w-full btn btn-primary py-2.5 text-center text-sm"
                                        >
                                            {copied ? 'Copied!' : 'Copy Invite Link'}
                                        </button>
                                        {/* Reset invite link — admin-only per Phase 69 CONTEXT D-INV-02.
                                            Rendered (not just disabled) only for owner/admin so non-admins
                                            don't see the button at all. */}
                                        {isAdmin && (
                                            <button
                                                onClick={handleResetInviteLink}
                                                disabled={resetting}
                                                className="mt-2 w-full btn btn-secondary py-2 text-xs text-status-error"
                                                title="Invalidate the current invite link and generate a new one"
                                            >
                                                {resetting ? 'Resetting…' : 'Reset invite link'}
                                            </button>
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
