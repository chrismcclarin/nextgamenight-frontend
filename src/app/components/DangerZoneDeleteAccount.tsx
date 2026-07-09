'use client';

/**
 * DangerZoneDeleteAccount — the irreversible account-deletion flow (Phase 87.2,
 * SPEC Req 7). Born-typed per the project preference for new primitives.
 *
 * UX contract (D-13..D-17):
 *   - A red-accented Danger Zone card with a single trigger button that opens a
 *     NON-DISMISSABLE danger modal (Modal.tsx, dismissable={false} — only
 *     outside-click is suppressed; Esc + close button still abandon the flow,
 *     which is non-destructive, RESEARCH Pitfall 10).
 *   - STATIC warning prose enumerates what is destroyed vs. what survives
 *     anonymized (D-17) — NO live counts, NO pre-flight spinner.
 *   - A fixed-phrase type-to-confirm gate: the confirm button stays disabled
 *     until the input exactly equals `delete my account` (D-15). No native
 *     confirm() is stacked on top.
 *   - On modal open (NEVER on page load) it calls getDeletionBlockers; while the
 *     pre-flight is pending the confirm input is disabled (no spinner). A 200
 *     with non-empty groups renders the blocked state WITHOUT ever issuing the
 *     DELETE. The pre-flight is a 200 { groups } body — it NEVER rejects with
 *     owner_of_active_groups (that code arrives only on the DELETE, the
 *     server-side TOCTOU re-check, D-10).
 *
 * DELETE outcome splits THREE ways (do NOT collapse them):
 *   1. BLOCKED — owner_of_active_groups @409 on the DELETE (or the pre-flight
 *      resolving 200 with non-empty groups): keep the modal open, render the
 *      blocked-groups list as named transfer links. The 409 list is NESTED at
 *      err.details.details.groups — read it via getEnvelopeDetails, never
 *      err.details.groups (which is undefined and renders a dead-end).
 *   2. AMBIGUOUS — network failure/timeout, 504/408 proxy abort, or
 *      not_found/410 (already deleted): navigate to logout->goodbye the same as
 *      success. A BFF 504 can arrive AFTER the backend commit, and an
 *      already-deleted account must never be left on a live session (Pitfall 9 /
 *      threat T-87.2-22).
 *   3. DEFINITIVE backend failure — 500/'internal' with a received response
 *      body, or any other 4xx not covered above: the transaction rolled back and
 *      NOTHING was deleted, so keep the session and the modal open with a
 *      safe-retry message. Destroying the session here would break the SPEC's
 *      retryable path.
 *
 * On success (and ambiguous outcomes) navigation is IMMEDIATE via
 * window.location — no toast-then-wait — so no authenticated fetch re-provisions
 * a JIT ghost Users row before logout completes (Pitfall 9). The
 * ?returnTo=/goodbye honoring itself is delivered by plan 87.2-08's handleLogout
 * allowlist provider; this component owns only the navigation URL string.
 */

import * as React from 'react';

import { Modal } from './Modal';
import {
  ApiError,
  getEnvelopeDetails,
  usersAPI,
  type DeletionBlockerGroup,
} from '@/lib/api';

const CONFIRM_PHRASE = 'delete my account';
const LOGOUT_GOODBYE_URL = '/api/auth/logout?returnTo=/goodbye';
const DEFINITIVE_FAILURE_MESSAGE =
  'Deletion failed — nothing was deleted. Please try again.';

/**
 * Classify a DELETE rejection into the three outcome lanes. The ApiError seam
 * already carries `code` (envelope-preferred) and `status`; a definitive failure
 * is one where a response body was actually received (an ApiError that is not a
 * client-side network throw). A raw abort/timeout (non-ApiError) is ambiguous —
 * the deletion may have committed server-side.
 */
type DeleteOutcome = 'blocked' | 'ambiguous' | 'definitive';

export function classifyDeleteError(err: unknown): DeleteOutcome {
  if (err instanceof ApiError) {
    // 1. Owner gate — the server-side TOCTOU re-check fired.
    if (err.code === 'owner_of_active_groups') return 'blocked';
    // 2a. Client-side network failure (apiFetch throws code 'network', status 0).
    if (err.code === 'network') return 'ambiguous';
    // 2b. Proxy abort — a BFF 504/408 can arrive AFTER the backend committed.
    if (err.status === 504 || err.status === 408) return 'ambiguous';
    // 2c. Already gone — repeat-DELETE tombstone / missing row.
    if (
      err.code === 'not_found' ||
      err.code === 'account_deleted' ||
      err.status === 410
    ) {
      return 'ambiguous';
    }
    // 3. Any other received-body failure (500/'internal', other 4xx) → the
    //    transaction rolled back; keep the session for a safe retry.
    return 'definitive';
  }
  // A non-ApiError throw: treat an abort/timeout as ambiguous (the request may
  // have committed server-side); anything else is definitive so we never destroy
  // the session on an unclassifiable failure.
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'ambiguous';
  return 'definitive';
}

/** Immediate, side-effecting navigation seam (overridable in tests). */
function navigateToLogout(): void {
  window.location.assign(LOGOUT_GOODBYE_URL);
}

export default function DangerZoneDeleteAccount(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [preflightPending, setPreflightPending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [blockedGroups, setBlockedGroups] = React.useState<
    DeletionBlockerGroup[] | null
  >(null);
  const [failureMessage, setFailureMessage] = React.useState<string | null>(
    null
  );

  const isBlocked = blockedGroups !== null && blockedGroups.length > 0;

  const resetState = React.useCallback(() => {
    setConfirmText('');
    setPreflightPending(false);
    setDeleting(false);
    setBlockedGroups(null);
    setFailureMessage(null);
  }, []);

  const handleClose = React.useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState]);

  // Pre-flight fires on MODAL OPEN — never on page load (D-17). The confirm
  // input is disabled while it is pending; a non-empty 200 renders the blocked
  // state without ever issuing the DELETE. The pre-flight NEVER rejects with the
  // owner code (contract) — a rare non-owner rejection (e.g. transient network)
  // is non-authoritative here, so we fall through to the normal confirm flow and
  // let the authoritative server-side gate re-check on the DELETE.
  const handleOpen = React.useCallback(() => {
    resetState();
    setOpen(true);
    setPreflightPending(true);
    usersAPI
      .getDeletionBlockers()
      .then((res) => {
        if (res.groups && res.groups.length > 0) {
          setBlockedGroups(res.groups);
        }
      })
      .catch((err) => {
        // Non-authoritative pre-flight failure — the DELETE re-checks the gate.
        console.error('Deletion-blockers pre-flight failed:', err);
      })
      .finally(() => setPreflightPending(false));
  }, [resetState]);

  const handleDelete = React.useCallback(async () => {
    if (confirmText !== CONFIRM_PHRASE) return;
    setDeleting(true);
    setFailureMessage(null);
    try {
      await usersAPI.deleteAccount();
      // Success — navigate IMMEDIATELY (no toast-then-wait, Pitfall 9).
      navigateToLogout();
    } catch (err) {
      const outcome = classifyDeleteError(err);
      if (outcome === 'blocked') {
        // The blocked-groups list is NESTED at err.details.details.groups —
        // read it through the typed envelope-details seam.
        const details =
          err instanceof ApiError
            ? getEnvelopeDetails<{ groups?: DeletionBlockerGroup[] }>(err)
            : undefined;
        setBlockedGroups(details?.groups ?? []);
        setDeleting(false);
        return;
      }
      if (outcome === 'ambiguous') {
        // Deletion may have committed server-side (or the account is already
        // gone) — never leave a live session on a possibly-deleted account.
        navigateToLogout();
        return;
      }
      // Definitive failure — the transaction rolled back; keep the session so
      // the SPEC-designed retry stays possible.
      setFailureMessage(DEFINITIVE_FAILURE_MESSAGE);
      setDeleting(false);
    }
  }, [confirmText]);

  const confirmDisabled =
    preflightPending || deleting || confirmText !== CONFIRM_PHRASE;

  return (
    <section className="card p-4 md:p-6 border border-status-error/40">
      <h2 className="text-lg font-bold text-status-error mb-2">Danger Zone</h2>
      <p className="text-sm text-content-secondary mb-4">
        Permanently delete your account and all associated data. This action
        cannot be undone.
      </p>
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-danger px-4 py-2 text-sm"
      >
        Delete My Account
      </button>

      <Modal open={open} onClose={handleClose} dismissable={false}>
        <Modal.Header>Delete your account</Modal.Header>
        <Modal.Body>
          {isBlocked ? (
            <div className="space-y-4">
              <p className="text-sm font-medium text-content-primary">
                You still own {blockedGroups!.length === 1 ? 'a group' : 'groups'}{' '}
                with other members. Before you can delete your account, transfer
                ownership or remove the members of each group below.
              </p>
              <ul className="space-y-2">
                {blockedGroups!.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between gap-3 rounded-btn border border-line p-3"
                  >
                    <a
                      href={`/groupHomePage?id=${encodeURIComponent(group.id)}`}
                      className="font-semibold text-content-link hover:underline"
                    >
                      {group.name}
                    </a>
                    <span className="text-xs text-content-secondary">
                      {group.memberCount}{' '}
                      {group.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-content-secondary">
                On each group&rsquo;s page, open Manage Members to transfer
                ownership to another member or remove members, then return here
                to delete your account.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-medium text-content-primary">
                This permanently deletes your account. It cannot be undone.
              </p>
              <div className="space-y-2 text-sm text-content-secondary">
                <p>The following are permanently destroyed:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Your groups and group memberships</li>
                  <li>Your RSVPs and event participation history</li>
                  <li>Your game library</li>
                  <li>Your game reviews</li>
                  <li>Your friendships</li>
                  <li>Your login identity</li>
                </ul>
                <p>
                  Past event records are kept but anonymized — your name is
                  removed from them.
                </p>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="delete-account-confirm"
                  className="block text-sm font-medium text-content-secondary"
                >
                  To confirm, type{' '}
                  <span className="font-bold text-content-primary">
                    {CONFIRM_PHRASE}
                  </span>{' '}
                  below:
                </label>
                <input
                  id="delete-account-confirm"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={preflightPending || deleting}
                  placeholder={CONFIRM_PHRASE}
                  autoComplete="off"
                  className="w-full rounded border border-red-300 bg-surface-input p-2 text-content-primary focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                />
              </div>
              {failureMessage && (
                <p
                  role="alert"
                  className="text-sm font-medium text-status-error"
                >
                  {failureMessage}
                </p>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Action variant="secondary" onClick={handleClose}>
            Cancel
          </Modal.Action>
          {!isBlocked && (
            <Modal.Action
              variant="danger"
              onClick={handleDelete}
              disabled={confirmDisabled}
            >
              {deleting ? 'Deleting…' : 'Delete my account'}
            </Modal.Action>
          )}
        </Modal.Footer>
      </Modal>
    </section>
  );
}
