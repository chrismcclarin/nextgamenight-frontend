'use client'
import { useState } from 'react';
import { groupsAPI } from '../../lib/api';
import FriendInvitePanel from './FriendInvitePanel';
import { Modal } from './Modal';
import { Input } from '../../components/ui/Input';

function CreateGroup({user, modal, modaltoggle, getGroupList, onGroupCreated}){

    const groupForm = {
        name: ""
    }

    const [newGroup, setNewGroup] = useState(groupForm)
    const [errorMessage, setErrorMessage] = useState('')
    const [createdGroup, setCreatedGroup] = useState(null)

    const handleChange = (event) => {
        setNewGroup({...newGroup, [event.target.id]: event.target.value})
        // Clear error message when user starts typing
        if (errorMessage) {
            setErrorMessage('')
        }
    }

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!newGroup.name.trim()) {
            // DECISION Phase 88-29 (Req 11 / DEF-88-16-01): this validation failure reports
            // through the component's OWN inline error slot, chosen OVER the browser
            // `alert()` it replaces and OVER inventing a toast string. The string is
            // unchanged, so no copy was authored — this phase forbids strings outside the
            // ratified register, and the register has none for this.
            //
            // The alert was reachable, not dead: the input carries `required`, so the
            // browser blocks a truly EMPTY submit, but a whitespace-only name passes
            // `required` and fails this `.trim()`. It was also the only user-facing error
            // in this file that skipped the `errorMessage` slot rendered 100 lines below —
            // a self-inconsistency inside one component. Restoring a native dialog here is
            // a decision, not a cleanup.
            setErrorMessage('Please enter a group name');
            return;
        }
        try {
            setErrorMessage(''); // Clear any previous errors
            const data = await createNewGroup(newGroup);
            setNewGroup(groupForm);
            modaltoggle();
            // Open the invite panel for the newly created group
            setCreatedGroup(data);
        } catch (error) {
            console.error('Error creating group:', error);
            // Show the actual error message from the API
            const errorMsg = error.message || 'Failed to create group. Please try again.';
            setErrorMessage(errorMsg);
        }
    }

    const createNewGroup = async (group) => {
        // Use groupsAPI.createGroup which automatically includes Authorization header
        const data = await groupsAPI.createGroup({
            name: group.name
        });

        // Refresh the group list after successful creation
        if (getGroupList) {
            getGroupList();
        }
        // Trigger refresh in GroupList component
        if (onGroupCreated) {
            onGroupCreated();
        }
        return data;
    }

    const handleInvitePanelClose = () => {
        setCreatedGroup(null);
    };

    const handleMemberAdded = () => {
        if (getGroupList) {
            getGroupList();
        }
        if (onGroupCreated) {
            onGroupCreated();
        }
    };

    return (
        <>
            {/* DECISION Phase 88-16 (SPEC Req 9): hosted on the shared <Modal>.
                `size="sm"` reproduces the old `max-w-sm` wrapper exactly, and the
                `onClick={modaltoggle}` + `stopPropagation` backdrop pair is gone
                rather than ported — Modal owns outside-dismiss, and it also adds
                the Esc/focus-trap this dialog never had.

                The title moves from `<h3 className="text-3xl …">` to the
                DialogTitle contract (20px/700) with NO pixel change, verified
                rather than assumed: the legacy `.modal-header h3 { font-size:
                1.25rem }` rule in globals.css is UNLAYERED, so it already beat
                the layered `text-3xl` utility — the heading has rendered at 20px
                the whole time. `text-3xl` was dead code, not a size decision, so
                nothing is being silently demoted here.

                The named red "Close" button below deliberately SURVIVES beside
                <Modal.Header>'s `×`. What this phase removes is NAMELESS close
                glyphs (SPEC Req 4); this one carries real text, is the dialog's
                only visible dismissal, and sits where the person's eye already
                is. It is the same shape as createEvent keeping its "Cancel"
                under a Modal header. Deleting it as a "duplicate" is a UX
                change, not a migration cleanup.

                The old `{modal && (…)}` guard is dropped rather than kept
                alongside `open={modal}`: two sources of truth for one dialog's
                open-ness is how a future edit changes one and not the other.
                Radix renders nothing when `open` is false, and this component's
                form state lives above the guard either way, so unmount timing
                is unchanged. `Modal.Body` is `p-0` with the padding pushed onto
                the <form>, because the "Close" button below is OUTSIDE the form
                and was outside the padded body before the migration too. */}
            <Modal open={modal} onClose={modaltoggle} size="sm">
                <Modal.Header>Create a new Group</Modal.Header>
                <Modal.Body className="p-0">
                    <form onSubmit={onSubmit} autoComplete="off" className="p-6">
                        <div className="mb-3 pt-0">
                            <div className="relative">
                                <Input
                                    id="name"
                                    name="group-name-create"
                                    onChange={handleChange}
                                    value={newGroup.name}
                                    type="text"
                                    placeholder="Group Name"
                                    required
                                    maxLength={40}
                                    autoComplete="off"
                                    aria-invalid={errorMessage ? 'true' : undefined}
                                    aria-describedby={errorMessage ? 'create-group-error' : undefined}
                                    className="relative pr-16 shadow-sm"
                                />
                                <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-content-muted pointer-events-none">
                                    {newGroup.name.length}/40
                                </span>
                            </div>
                            {/* DECISION Phase 88-29 (Req 11 / DEF-88-19-04 shape): `role="alert"`
                                — ASSERTIVE, chosen over `role="status"`. Both things routed here
                                are submit-time failures the person has just caused and is waiting
                                on, so interrupting is correct; 88-25 made the same call on
                                `userProfile`'s phone error and used polite only for the
                                types-as-you-go format hint. Without a role this node is silent to
                                a screen reader, which would make replacing the native `alert()`
                                above an a11y REGRESSION — an alert dialog is announced. */}
                            {errorMessage && (
                                <p id="create-group-error" role="alert" className="mt-2 text-sm text-red-600">{errorMessage}</p>
                            )}
                        </div>
                        {/* Owner report 2026-08-04: button sat off-center under the input.
                            Plain utilities instead of the legacy `.modal-footer` class —
                            the unlayered global (flex-end + its own 1.5rem padding inside
                            the padded body) can never line up with the input, and layered
                            utilities lose to it, so the class came off rather than fighting it.
                            DECISION Phase 88-16: the CASCADE half of that reasoning is now
                            moot (no unlayered rule reaches this subtree any more), but the
                            OUTCOME is re-affirmed, not inherited by accident: this stays a
                            centered in-body row rather than becoming a <Modal.Footer>, which
                            is `justify-end` by contract and would re-create the exact
                            off-center look the owner reported. Converging this one dialog on
                            the fleet footer is a decision, not a cleanup. */}
                        <div className="flex justify-center pt-1">
                            <button
                                className="btn btn-primary font-bold uppercase text-sm px-6 py-3 shadow-sm hover:shadow-lg min-h-11"
                                type="submit"
                            >
                                Create Group
                            </button>
                        </div>
                    </form>
                    <button
                        className="text-status-error background-transparent font-bold uppercase px-6 py-2 text-sm outline-hidden focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 active:opacity-75 mr-1 mb-1 ease-linear transition-all duration-150"
                        type="button"
                        onClick={modaltoggle}
                    >
                        Close
                    </button>
                </Modal.Body>
            </Modal>

            {/* Auto-opened for the group that was just created (deliberate since
                19de50a). `openedFrom="create"` is what earns the panel its
                create-path header + lead-in (Phase 88-15, UI-SPEC §6.3) —
                without it the generic "Invite Members" reads as an accidental
                click-through, which is exactly how the owner read it. */}
            <FriendInvitePanel
                group={createdGroup}
                open={!!createdGroup}
                openedFrom="create"
                onClose={handleInvitePanelClose}
                onMemberAdded={handleMemberAdded}
            />
        </>
    );
}

export default CreateGroup;
