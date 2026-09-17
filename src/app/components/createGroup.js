'use client'
import { useEffect, useRef, useState } from 'react';
import { groupsAPI } from '../../lib/api';
import FriendInvitePanel from './FriendInvitePanel';
import { Modal } from './Modal';
import { Input } from '../../components/ui/Input';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { Button } from '../../components/ui/Button';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { logger } from '@/lib/logger';

function CreateGroup({user, modal, modaltoggle, getGroupList, onGroupCreated}){

    const groupForm = {
        name: ""
    }

    const [newGroup, setNewGroup] = useState(groupForm)
    const [errorMessage, setErrorMessage] = useState('')
    const [createdGroup, setCreatedGroup] = useState(null)
    const [submitting, setSubmitting] = useState(false)
    const nameInputRef = useRef(null)
    // Wave-12 review MED #20: the real `disabled` during the pending window
    // drops keyboard focus to body; on a FAILED settle the dialog stays open,
    // so return focus to the re-enabled submit. On success the modal closes
    // and the ref is gone — the focus call no-ops.
    const submitButtonRef = useRef(null)
    const wasSubmitting = useRef(false)
    useEffect(() => {
        if (wasSubmitting.current && !submitting) {
            submitButtonRef.current?.focus();
        }
        wasSubmitting.current = submitting;
    }, [submitting])

    /* DECISION Phase 88-33 Task 4 (UAT row 447): while a create request is IN FLIGHT the
       dialog is genuinely non-dismissible — Esc, the header ×, and outside-click are ALL
       inert, because every one of them routes through this single guarded onClose (Radix
       funnels Esc/×/outside into onOpenChange -> onClose; see Modal.tsx handleOpenChange).
       Chosen OVER `dismissable={false}`, which suppresses ONLY outside-click and would
       have left Esc and the × able to dismiss mid-create — the exact walk failure ("pressed
       enter... I was able to press escape and exit the modal before the friends modal came
       up"). This is a BOUNDED pending-window exception to WCAG 2.1.2 No Keyboard Trap, not
       a trap: the window spans only the in-flight request and every outcome exits it
       automatically — success closes the modal via the normal handoff, and failure
       re-enables closability in onSubmit's finally. Trapping this at the Modal primitive
       instead was rejected (fleet-wide keyboard trap for one consumer's transient need). */
    const handleClose = () => {
        if (submitting) return;
        modaltoggle();
    }

    const handleChange = (event) => {
        setNewGroup({...newGroup, [event.target.id]: event.target.value})
        // Clear error message when user starts typing
        if (errorMessage) {
            setErrorMessage('')
        }
    }

    const onSubmit = async (e) => {
        e.preventDefault();
        // Double-submit guard: Enter + a fast second click during the same
        // in-flight request must not create two groups (UAT row 447).
        if (submitting) return;
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
            setSubmitting(true);
            const data = await createNewGroup(newGroup);
            setNewGroup(groupForm);
            modaltoggle();
            // Open the invite panel for the newly created group
            setCreatedGroup(data);
        } catch (error) {
            /* DECISION Phase 88.6-33 (AC-2 WIDENED x AC-16 a): ONE escalation for this failure
               path — `logger.error` over `console.error` PLUS a hand-rolled
               Sentry capture. `logger.error(msg, err)` IS the capture AC-16 (a)
               (owner 2026-09-09, wording amended 2026-09-13 D7 arm A) asked for: it routes
               through Sentry's captureException with the error object and the verbatim message
               in `extra.msg` — see `src/lib/logger.ts:28-30` for the exact call, which is
               deliberately NOT reproduced here so a call-shaped grep over this file cannot read
               prose as a second capture. Adding a real second capture beside it is a decision,
               not a cleanup.

               `logger.error` and NOT this plan's `logger.info` default (owner ruling
               2026-09-13, D2) — this is the plan's ONE carve-out, earned by AC-16 (a)'s
               escalation requirement, and it is the ONLY new Sentry EVENT plan 33 creates.
               Do not generalise it: the plan's other four conversions are breadcrumbs.

               T-84-01 (`src/lib/logger.ts:8-13`) bounds what the CALLER adds — no group name,
               no request-body field, no member list, no invite URL or token. It does NOT bound
               the error's own `name`/`message`/stack, which `exceptionFromError` serialises
               into `exception.values[0]`; on this path the backend echoes its own text
               (`Sonnet/routes/groups.js:297`, `:332`). That residual is owner-accepted
               (2026-09-13). */
            logger.error('Error creating group:', error);
            /* DECISION Phase 88.6-33 (R1 / DEF-88-25-01): the ratified register string over the
               raw `error.message` this line used to read and over its hand-rolled
               "Failed to create group. Please try again." fallback. `getFetchErrorMessage(error)`
               with NO fallback: UI-SPEC §6.2.1 (§6.3) has no entry for this action, so the
               register's own `unknown` line answers and no copy is authored (P1).

               A VALUE change ONLY — this is UI-SPEC §14 A-30's NAMED §6.2 EXCEPTION, scoped to
               this file alone. The modal-submit toast arm (§6.2 `:552`) is declined here because
               §6.2's own announcement clause (`:555-557`) forbids a second live region, and this
               surface already owns one WITH field association (`aria-invalid` / `aria-describedby`
               on the name input, over the `role="alert"` node below under the
               `DECISION Phase 88-29` marker). A toast would cost that association. Plans 31 and 32
               classify sites against §6.2 too and MUST NOT inherit this. */
            const errorMsg = getFetchErrorMessage(error);
            setErrorMessage(errorMsg);
        } finally {
            // Re-enable close on EVERY settle: success closes via modaltoggle above;
            // failure must not leave the person stuck in an undismissable dialog.
            setSubmitting(false);
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

                AMENDED (88-33 Task 9, D-39 house style): the red "Close" button is now
                REMOVED — the owner reopened this decision on the 2026-08-13 walk (UAT
                row 283, routed 2026-08-15): "I think we can get rid of the red close
                button as we have the x in the top left. Maybe make the x red?" The
                header × takes the error color (closeClassName) as its replacement, and
                remains the dialog's one named close affordance. ORIGINAL MARKER,
                verbatim (kept per the amendment rule): "The named red 'Close' button
                below deliberately SURVIVES beside <Modal.Header>'s `×`. What this phase
                removes is NAMELESS close glyphs (SPEC Req 4); this one carries real
                text, is the dialog's only visible dismissal, and sits where the
                person's eye already is. It is the same shape as createEvent keeping its
                'Cancel' under a Modal header. Deleting it as a 'duplicate' is a UX
                change, not a migration cleanup." That UX change has now been made — as
                an owner decision, not a cleanup. Restoring the button reopens row 283.

                The old `{modal && (…)}` guard is dropped rather than kept
                alongside `open={modal}`: two sources of truth for one dialog's
                open-ness is how a future edit changes one and not the other.
                Radix renders nothing when `open` is false, and this component's
                form state lives above the guard either way, so unmount timing
                is unchanged. `Modal.Body` is `p-0` with the padding pushed onto
                the <form>, because the "Close" button below is OUTSIDE the form
                and was outside the padded body before the migration too. */}
            {/* 88-33 Task 4 (UAT row 291, fleet initial-focus policy): a form-bearing modal
                opens with focus on its first meaningful input — here the group name — so
                the person can just start typing. */}
            <Modal open={modal} onClose={handleClose} size="sm" initialFocusRef={nameInputRef}>
                {/* Red ×: the owner-ruled replacement for the removed red Close button
                    (UAT row 283) — see the amended marker above. */}
                <Modal.Header
                    closeDisabled={submitting}
                    closeClassName="text-content-status-error hover:text-content-status-error"
                >
                    Create a new Group
                </Modal.Header>
                <Modal.Body className="p-0 md:p-0">
                    <form onSubmit={onSubmit} autoComplete="off" className="p-6" aria-busy={submitting || undefined}>
                        <div className="mb-3 pt-0">
                            <div className="relative">
                                {/* DECISION Phase 88.6-33 (D49-b, owner ruling 2026-09-09
                                    option i): the Input below carries `shadow-theme-sm`, chosen
                                    OVER the Tailwind BUILT-IN elevation utility it shipped.
                                    (The pre-snap spelling is deliberately NOT written here — this
                                    plan's gate is a raw grep over this file, so quoting it would
                                    make the gate self-fail on its own disclosure. It is recorded
                                    in `88.6-33-SUMMARY.md` and in the `createGroup.js` deletion
                                    note in `src/app/shadowTier.test.ts`, with both measured
                                    values.)

                                    WHY IT IS A LOOK CHANGE AND NOT A RESPELLING: Tailwind v4
                                    INLINES its built-in scale's literal values into its built-in
                                    utilities rather than reading the `--shadow-*` properties (see
                                    the DECISION Phase 87.7 marker in globals.css), so the
                                    project's own none-equivalent value reaches `shadow-theme-sm`
                                    through `var()` and never reached the built-in one. The
                                    shipped control therefore had a real black shadow, and this
                                    snap REMOVES it. Disclosed for `/gsd-ui-review`.

                                    NO hover pin: UI-SPEC §3.4 rule 2 governs button elevation
                                    PAIRS, and this is a container/input with no hover half.
                                    Going back to the built-in family is a decision, not a
                                    cleanup. */}
                                <Input
                                    ref={nameInputRef}
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
                                    className="relative pr-16 shadow-theme-sm"
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
                            {/* DECISION Phase 88.6-33 (D49-b i / UI-SPEC §3.4 rule 2 / D-30): the
                                submit CTA is a `<Button variant="primary">` carrying
                                `shadow-theme-sm enabled-hover:shadow-theme-lg`.

                                THE PIN IS LOAD-BEARING, and rule 2's own subject list could not
                                see this site: the census scanned `shadow-theme-*` spellings, and
                                this control spelled BOTH halves of its elevation with Tailwind
                                v4's BUILT-IN elevation utilities. (The pre-snap spelling is
                                deliberately NOT quoted here — this plan's gate is a raw grep over
                                this file and quoting it would make the gate self-fail on its own
                                disclosure. Both measured before/after values are in
                                `88.6-33-SUMMARY.md` and in the `createGroup.js` deletion note in
                                `src/app/shadowTier.test.ts`.)

                                Those built-ins are NOT aliases of the theme tokens — v4 inlines
                                its built-in scale's literals (DECISION Phase 87.7 in globals.css)
                                — so TWO separate things were wrong here: (a) the resting shadow
                                was a real off-tier black one, which makes removing it a DISCLOSED
                                look delta rather than a no-op; and (b) `Button`'s cva base emits
                                `enabled-hover:shadow-theme-md`, which is one tier SMALLER than
                                the elevation this control shipped on hover, so migrating without
                                a pin would have INVERTED its hover. `enabled-hover:` and never a
                                bare `hover:` (D10) — a bare one does not dedupe against the base
                                token, so both would paint, and it would re-lift this control
                                while it is `disabled`.

                                DELETED AS DEAD, not as unwanted — `.btn` is unlayered
                                (globals.css:2194-2205) and declares font-weight (`font-bold`),
                                font-size (`text-sm`) and padding (`px-6 py-3`); `.btn:disabled`
                                declares `opacity: 0.5` (`:2250-2253`), which is byte-identical to
                                the `disabled:opacity-50` that rode here. `uppercase` SURVIVES:
                                `.btn` declares no `text-transform`, so it was never dead.
                                `min-h-11` is dropped as REDUNDANT against plan 06's cva base
                                (Button.tsx:168), the same disposition plan 32 gave
                                `GroupGamesList.js` under D-30 in this wave.

                                THE THREE CARRIED-ACROSS PROPS ARE NOT DECORATION. `Button`
                                destructures `type` with a default of `'button'`
                                (Button.tsx:267), so dropping `type="submit"` would silently turn
                                the form's submit control inert and the modal would stop creating
                                groups — a regression no type checker and no class census can see.
                                `ref` feeds the failed-settle focus return (the wave-12 MED #20
                                marker above) and `disabled` feeds the UAT row 447 double-submit
                                guard. All three are pinned behaviourally in createGroup.test.tsx. */}
                            <Button
                                ref={submitButtonRef}
                                variant="primary"
                                className="uppercase shadow-theme-sm enabled-hover:shadow-theme-lg"
                                type="submit"
                                disabled={submitting}
                            >
                                {submitting ? 'Creating...' : 'Create Group'}
                            </Button>
                        </div>
                        {/* The submit label swap alone is silent to screen readers — announce the
                            in-flight state via a live region (empty-first, StatusRegion contract). */}
                        <StatusRegion politeness="polite" className="sr-only">
                            {submitting ? 'Creating group...' : ''}
                        </StatusRegion>
                    </form>
                    {/* (88-33 Task 9, UAT row 283: the red "Close" button that lived here is
                        REMOVED — owner preference; the header × is now red and is the one
                        named close affordance. See the amended marker above. Task 4's
                        submitting guard now has one fewer affordance to cover: Esc, the
                        red ×, and outside-click all route through the guarded onClose.) */}
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
