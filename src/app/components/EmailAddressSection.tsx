'use client';

/**
 * EmailAddressSection — the address this app uses to reach you (Phase 88.8 plan
 * 13, BOPS-05 / SPEC R12 as amended by A9, A11, A12, A13; D-09 as re-ruled,
 * D-29, D-30, D-31, D-32, D-33, D-34, D-38, D-39).
 *
 * There is ONE address, `Users.email`. This section shows it, lets the user
 * change it, proves the new one with a code MAILED to it, and puts it back.
 * There is no page the mail links to — the mail carries a CODE, not a link
 * (D-09 as re-ruled by the owner 2026-09-03, after the plan review showed link
 * scanners auto-firing verification pages). Nothing arrives on this page by URL,
 * so there is no return receipt and no return effect (D-32 as amended).
 *
 * UX contract:
 *   - EIGHT states. Six are visible product states (D-31 as amended): idle,
 *     editing, saving, awaiting-code, verifying, verified. TWO more exist only
 *     because the data arrives asynchronously: `unresolved` and `unavailable`.
 *   - Hydration is ONE-SHOT and comes from the self identity row ALONE (D-39) —
 *     `email`, `email_changed_at`, `pending_email_change`. The section issues no
 *     fetch of its own; a section-level GET would duplicate the immortal self
 *     query on every profile mount.
 *   - After every mutation it patches the identity cache from the RESPONSE BODY
 *     fields, never from the typed input, so the profile header a few hundred
 *     pixels above moves in the SAME paint.
 *
 * FOUR FAILURE OUTCOMES THAT MUST NOT COLLAPSE INTO ONE ANOTHER — each has its
 * own fixed string, and the colocated suite asserts them separately:
 *   1. `invalid`       — the code was wrong.
 *   2. `expired`       — the code was right but too old; Resend is promoted.
 *   3. `address_taken` — the code was RIGHT and the address belongs to someone
 *                        else. Telling this user their code "isn't right" would
 *                        be false, and would hide a real account conflict behind
 *                        a retry prompt.
 *   4. a TRANSPORT failure (network, 5xx) — the shared error-message helper's
 *                        copy. A network blip must never read as a wrong code.
 * Plus two LOCAL rejections that never leave the browser (incomplete code,
 * out-of-alphabet character) with their own two strings, because the section
 * KNOWS it never sent them and reporting the result of a round trip that did not
 * happen would be a lie.
 *
 * All fixed user-facing copy lives in module-level constants and is NEVER
 * interpolated from a server string (DECISION Phase 88-25, at
 * `useFetchErrorState.ts:120-139`).
 *
 * DESIGN CONTRACTS INHERITED BY CITATION (D-34). No visual contract document was
 * produced for this phase, on the owner's ruling, because this section is 100%
 * shipped primitives and introduces no new visual element. It inherits
 * `88-UI-SPEC.md` 8.1 (button), 8.2 (input), 6.2 `:349-351` (receipt wording as
 * object plus past-tense verb), `:336` (toast lifetime), `:512` (visible
 * labels), and `DESIGN-SYSTEM-REFERENCE-2026.md` `:330` (reflow) / `:334-349`
 * (flatten). If a NEW visual element turns out to be wanted — a status pill, say
 * — stop and raise it rather than inventing one.
 *
 * PHONE-FORWARD, which is a project tenet and not a preference: the base classes
 * ARE the phone layout and `sm:` only reflows column to row. Every interactive
 * control here is measured at 375px in `e2e/touch-targets.spec.ts` (DR-A) — the
 * vitest suite asserts NO geometry, because jsdom cannot measure it.
 */

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { FormField } from './form/FormField';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { ApiError, usersAPI } from '@/lib/api';
import { patchSelfCache } from '@/lib/hooks/selfIdentityCache';
import { useSelfIdentity } from '@/lib/hooks/useSelfIdentity';
import type { EmailChangeResponse } from '@/lib/schemas/users';
import { isSyntheticAddress } from '@/lib/syntheticAddress';

/* ── FIXED COPY ─────────────────────────────────────────────────────────────
   Everything the user reads. Module-level constants, never interpolated from a
   server string. Only ONE of these is exported — see the note on it. */

/**
 * The ONE exported copy constant. `src/app/userProfile/page.js` renders the
 * SAME string in the profile header when the resolved address is synthetic, and
 * the page already imports this module for the mount — so exporting the constant
 * is what stops the header and the section drifting into two spellings of one
 * fixed string. Every other constant in this file stays private.
 */
export const NO_ADDRESS_ON_FILE = 'No email address on file';

const SECTION_TITLE = 'Email';
const SECTION_HELPER =
  'This is the address we use to reach you about game nights. It is not how you sign in.';
const SYNTHETIC_HELPER =
  "We don't have a working address for you yet, so nothing we send can reach you. Add one below.";

const UNRESOLVED_COPY = 'Loading the address we have for you…';
const UNAVAILABLE_COPY =
  "We couldn't load the address we have for you. Refresh the page to try again.";

const NOT_VERIFIED_LABEL = 'Not verified yet';
const CURRENT_ADDRESS_LABEL = 'The address we use now';

const EMPTY_EMAIL_ERROR = 'Enter the address you want us to use';
const MALFORMED_EMAIL_ERROR = "That doesn't look like an email address";
const INCOMPLETE_CODE_ERROR = 'Enter all 8 characters from the email';
/* The Crockford alphabet omits I, L, O and U. Plan 09's verify handler DECODES
   the first three before validating (`CROCKFORD_CONFUSABLES = { O: '0', I: '1',
   L: '1' }`, routes/users.js:1750), and this section decodes them identically —
   so a hand-transcribed I, L or O is ACCEPTED, not rejected, and naming those
   three here would send a user hunting for characters the server takes happily.
   `U` has no decode on either side, and neither does stray punctuation. */
const OUT_OF_ALPHABET_ERROR =
  "That code has a character we don't use — our codes never contain a U, and the only punctuation is the optional dash";
const INVALID_CODE_ERROR = "That code isn't right — check the email and try again";
const EXPIRED_CODE_ERROR = 'That code has expired';
const ADDRESS_TAKEN_ERROR =
  'Another account already uses that address. Ask us for help if it should be yours.';
const RATE_LIMITED_ERROR = "You've asked for too many codes. Try again in a little while.";
const RESEND_COOLDOWN_ERROR = 'You can ask for another code in a moment';
const MAIL_REFUSED_COPY =
  "We couldn't send the code just now. Your change is still waiting — use Resend code to try again.";
const UNCHANGED_COPY = "That's already the address we use for you";
const CODE_FORMAT_HINT = '8 characters, letters and numbers. Dashes are optional.';
const REVERT_HELPER = 'This puts your address back to the one you sign in with.';

const CHANGED_RECEIPT = 'Email address changed';
const REVERTED_RECEIPT = 'Email address reverted';
const DISCARDED_RECEIPT = 'Email change discarded';

const LABEL_CHANGE = 'Change';
const LABEL_SAVE = 'Save';
const LABEL_CANCEL = 'Cancel';
const LABEL_VERIFY = 'Verify';
const LABEL_RESEND = 'Resend code';
const LABEL_DISCARD = 'Discard change';
const LABEL_REVERT = 'Use my sign-in address';

/* ── CODE NORMALISATION ─────────────────────────────────────────────────────
   Mirrors routes/users.js `normaliseEmailChangeCode` (:910-912) plus its
   confusable decode (:1750) and its alphabet (:1751), so this client is never
   STRICTER than the contract. A client-side gate that rejected a code the server
   would accept is a defect, not a safety margin. */
const CROCKFORD_CONFUSABLES: Record<string, string> = { O: '0', I: '1', L: '1' };
const CODE_ALPHABET = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const CODE_LENGTH = 8;

/** Uppercase, drop dashes and whitespace, decode the three confusables. */
export function normaliseEmailChangeCode(raw: string): string {
  return raw
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/[OIL]/g, (ch) => CROCKFORD_CONFUSABLES[ch]);
}

/**
 * Local pre-flight for the code field. Exported so the colocated suite can pin
 * the three outcomes cheaply, the same seam `classifyDeleteError` gives
 * `DangerZoneDeleteAccount`.
 */
export type CodeCheck = 'ok' | 'incomplete' | 'out-of-alphabet';

export function checkCode(raw: string): CodeCheck {
  const normalised = normaliseEmailChangeCode(raw);
  if (normalised.length < CODE_LENGTH) return 'incomplete';
  if (!CODE_ALPHABET.test(normalised)) return 'out-of-alphabet';
  return 'ok';
}

/* Deliberately permissive: the BACKEND owns address validation
   (`EMAIL_FORMAT`, routes/users.js), and a stricter client regex would reject
   addresses the server accepts — the same class of defect as an over-strict
   code gate. This catches only the obvious typo so the user is not made to wait
   for a round trip to be told there is no `@`. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESEND_COOLDOWN_MS = 30_000;

type SectionState =
  | 'unresolved'
  | 'unavailable'
  | 'idle'
  | 'editing'
  | 'saving'
  | 'awaiting-code'
  | 'verifying'
  | 'verified';

type FocusTarget = 'change' | 'email' | 'code' | 'resend' | 'revert' | null;

/** The shared error copy for a thrown failure, with the two NAMED envelopes. */
function messageFor(error: unknown): string {
  return getFetchErrorMessage(error, { byCode: { rate_limited: RATE_LIMITED_ERROR } });
}

function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'rate_limited';
}

/**
 * A mutation body we can act on. Scoped to MUTATION responses ONLY — it can
 * never fire on hydration, where `email` is read off the self row and the
 * absence of a key means something entirely different.
 */
function isUsableMutationBody(body: EmailChangeResponse | undefined | null): boolean {
  return Boolean(body && typeof body.email === 'string' && body.email.length > 0);
}

export function EmailAddressSection() {
  const { self, query: selfQuery } = useSelfIdentity();
  const queryClient = useQueryClient();

  const [state, setState] = React.useState<SectionState>('unresolved');
  const [emailInput, setEmailInput] = React.useState('');
  const [codeInput, setCodeInput] = React.useState('');
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [revertError, setRevertError] = React.useState<string | null>(null);
  const [sentLine, setSentLine] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(
    null
  );
  const [resendPromoted, setResendPromoted] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(false);
  const [focusTarget, setFocusTarget] = React.useState<FocusTarget>(null);

  const hydratedRef = React.useRef(false);
  /* The section sent a code in THIS session. The one thing that licenses the
     "your code expired" copy outside a verify round trip — see the defensive arm
     below. */
  const sentThisSessionRef = React.useRef(false);
  /* And the section has ACTUALLY SEEN a live pending row on `self`. Both halves
     are required: "goes null" is a TRANSITION, not a state, so the arm below
     must not fire on a `self` that was null all along. Without this the arm
     fires the instant a Save succeeds against a self row the cache patch has not
     reached yet — which is a real code path, because `patchSelfCache` is a
     documented no-op when the cache is empty
     (selfIdentityCache.ts:29-31) — and the user is told their brand-new code has
     expired. Found by this plan's own colocated suite. */
  const sawPendingRef = React.useRef(false);
  const cooldownTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const changeRef = React.useRef<HTMLButtonElement>(null);
  const emailInputRef = React.useRef<HTMLInputElement>(null);
  const codeInputRef = React.useRef<HTMLInputElement>(null);
  const resendRef = React.useRef<HTMLButtonElement>(null);
  const revertRef = React.useRef<HTMLButtonElement>(null);

  const reactId = React.useId();
  const emailFieldId = `${reactId}-email`;
  const codeFieldId = `${reactId}-code`;
  const codeHintId = `${reactId}-code-hint`;

  const selfId = self?.id;
  const currentAddress = self?.email ?? null;
  const currentIsSynthetic = isSyntheticAddress(currentAddress);
  const pendingAddress = self?.pending_email_change?.address ?? null;
  const hasChangedBefore = Boolean(self?.email_changed_at);

  /* ── HYDRATION, ONE SHOT ──────────────────────────────────────────────────
     The idiom is already shipped in this component's host page at
     `src/app/userProfile/page.js:798-839`, and the reason is stated there in
     the repo's own words: the self cache is `staleTime: Infinity` and mutation
     handlers own their own local-state updates and cache writes, "so a reactive
     re-init on every `self` change would risk clobbering an in-progress edit".

     That hazard is SHARPER here than there. This section patches the identity
     cache after EVERY mutation, so a reactive hydration would re-derive the
     state from the row it just wrote and throw a user out of awaiting-code the
     instant their Save succeeded.

     NOTE THE ONE DIFFERENCE FROM THE HOST PAGE'S VERSION, and do not copy that
     one blindly: its effect writes editable FORM state, so it may return early
     forever once initialised. This one also decides WHICH STATE the section
     renders, so the `unresolved` and `unavailable` arms below are rendered from
     the LIVE query flags and only the STATE-DERIVATION is one-shot.

     DECISION Phase 88.8 (D-39): hydration is ONE-SHOT and ref-guarded, chosen
     OVER three alternatives that were each considered and rejected:
       (a) deriving the state reactively from `self` on every render — it
           clobbers an in-progress change on the section's OWN cache patch;
       (b) a mount-only `useEffect` with an empty dependency array — at mount
           `self` is `undefined` (`useSelfIdentity.ts:117` returns `query.data`
           on an `enabled`-gated, `staleTime: Infinity` query), so a user with a
           pending change would NEVER reach awaiting-code. That is the PRIMARY
           flow: "request the change, leave to read the mail on your phone, come
           back";
       (c) rendering idle while unresolved — an empty address with a live
           Change action beside it.
     Restoring any of the three is a decision, not a cleanup. */
  React.useEffect(() => {
    if (hydratedRef.current) return;
    if (selfQuery.isError) {
      hydratedRef.current = true;
      setState('unavailable');
      return;
    }
    if (!self) return;
    hydratedRef.current = true;

    /* Truthiness on the pending OBJECT, never `=== null` or `=== false`: an
       absent field must map to idle rather than falling through unmapped.

       THE EXPIRED-CODE ARM, reconciled with plan 09 Task 3 so the two plans say
       ONE thing. Plan 09's self read returns `pending_email_change: null` for an
       EXPIRED row deliberately — an expired row must not hydrate a live-looking
       awaiting-code state built on a dead code. At MOUNT the section therefore
       lands in IDLE: not an error, and NOT behind an "your code expired"
       banner. With no send made in this session it cannot tell "the code
       expired" from "nothing was ever requested", and it must not guess — that
       banner would greet every first-time visitor. The exit from idle is
       Change, which mints a fresh code. "That code has expired" lives on the
       VERIFY round trip (`outcome: 'expired'`), the only path that knows the
       difference, and plan 09's resend predicate carries NO `expires_at` clause
       (routes/users.js:1326-1346) so the Resend that outcome promotes can
       actually serve the row.

       NEVER key hydration on `verification_sent`. That is a
       MUTATION-RESPONSE-ONLY key: `toSelfWire` carries `email`,
       `email_changed_at` and `pending_email_change` and no `verification_sent`
       at all, so keying on it leaves it `undefined`, no arm matches, and the
       primary flow dies with no code input on screen.

       And do NOT copy the phone block's hydration mapping at
       `userProfile/page.js:824-839`: it maps a stored-but-unverified value to
       `'idle'` and never re-enters the pending state from the self row. Its
       STATE MACHINE is worth mirroring; that mapping would make the mailed code
       unusable after any reload inside its 30-minute life (SPEC A9), with
       re-requesting — which revokes that code — the only escape. */
    if (self.pending_email_change) {
      setState('awaiting-code');
      // No "We sent a code to …" line: no mail was sent in THIS session.
      setSentLine(null);
      return;
    }
    setState('idle');
  }, [self, selfQuery.isError]);

  /* ── THE ONE DEFENSIVE ARM ────────────────────────────────────────────────
     A SESSION-LOCAL send followed by a self row that goes null is the ONE case
     where this section may say a code is gone. If it sent a code this session
     and is standing in awaiting-code when a later `self` carries
     `pending_email_change: null` for a reason OTHER than its own Discard or a
     successful Verify (both of which move the state first), show awaiting-code
     with the expired copy and Resend promoted rather than silently dropping to
     idle.

     THIS ARM IS UNREACHABLE TODAY and is written anyway, so it does not read as
     dead code someone should delete: the self query is `staleTime: Infinity` and
     its docblock states the row "NEVER self-refreshes"
     (`useSelfIdentity.ts:34`, `:102`), so an expiry never pushes a null to a
     mounted client. It costs one branch, and "silently drop to idle" is the
     failure it prevents. */
  React.useEffect(() => {
    if (!hydratedRef.current) return;
    if (self?.pending_email_change) {
      sawPendingRef.current = true;
      return;
    }
    if (state !== 'awaiting-code') return;
    if (!sentThisSessionRef.current) return;
    if (!sawPendingRef.current) return;
    setCodeError(EXPIRED_CODE_ERROR);
    setResendPromoted(true);
    setSentLine(null);
  }, [self?.pending_email_change, state]);

  /* ── FOCUS ────────────────────────────────────────────────────────────────
     One target per USER-CAUSED transition, applied after the DOM has settled.
     MOUNT AND HYDRATION MOVE NO FOCUS — landing on the profile page, and the
     unresolved -> hydrated transition, must not steal focus from wherever the
     user is on a long page. `focusTarget` is only ever set inside a handler. */
  React.useEffect(() => {
    if (!focusTarget) return;
    const node = {
      change: changeRef.current,
      email: emailInputRef.current,
      code: codeInputRef.current,
      resend: resendRef.current,
      revert: revertRef.current,
    }[focusTarget];
    node?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  React.useEffect(
    () => () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    },
    []
  );

  const startCooldown = React.useCallback(() => {
    setCooldown(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => setCooldown(false), RESEND_COOLDOWN_MS);
  }, []);

  /** Every mutation response lands here first: the cache patch is not optional. */
  const applyToCache = React.useCallback(
    (body: EmailChangeResponse) => {
      patchSelfCache(queryClient, {
        email: body.email,
        email_changed_at: body.email_changed_at,
        pending_email_change: body.pending_email_change,
      });
    },
    [queryClient]
  );

  const clearCodeField = React.useCallback(() => {
    // Cleared after EVERY outcome. The code is never rendered into a status
    // line, a toast or a URL either.
    setCodeInput('');
  }, []);

  /* ── HANDLERS ─────────────────────────────────────────────────────────── */

  const handleChange = () => {
    setEmailInput('');
    setEmailError(null);
    setNotice(null);
    setRevertError(null);
    setState('editing');
    setFocusTarget('email');
  };

  const handleCancelEdit = () => {
    setEmailError(null);
    setState('idle');
    setFocusTarget('change');
  };

  const handleSave = async () => {
    // DR-C: the press is blocked in the HANDLER, and the gated control tells
    // the user what is missing rather than doing nothing.
    if (state === 'saving') return;
    const value = emailInput.trim();
    if (!value) {
      setEmailError(EMPTY_EMAIL_ERROR);
      return;
    }
    if (!EMAIL_SHAPE.test(value)) {
      setEmailError(MALFORMED_EMAIL_ERROR);
      return;
    }
    if (!selfId) return;

    setEmailError(null);
    setNotice(null);
    setState('saving');
    try {
      const body = await usersAPI.requestEmailChange(selfId, value);
      if (!isUsableMutationBody(body)) {
        setState('editing');
        setEmailError(messageFor(null));
        setFocusTarget('email');
        return;
      }
      applyToCache(body);

      if (body.outcome === 'unchanged') {
        setState('idle');
        setNotice({ tone: 'info', text: UNCHANGED_COPY });
        setSentLine(null);
        setFocusTarget('change');
        return;
      }
      if (body.outcome === 'code_sent') {
        sentThisSessionRef.current = true;
        setState('awaiting-code');
        clearCodeField();
        setCodeError(null);
        if (body.verification_sent) {
          setSentLine(`We sent a code to ${body.pending_email_change?.address ?? value}`);
          setNotice(null);
          setResendPromoted(false);
          startCooldown();
        } else {
          // A mail the PROVIDER refused. Never the "code sent" line — the token
          // survives (the owner's 2026-09-04 ruling) so Resend is the remedy.
          setSentLine(null);
          setNotice({ tone: 'error', text: MAIL_REFUSED_COPY });
          setResendPromoted(true);
        }
        setFocusTarget('code');
        return;
      }
      // Contract drift: a request answering with a verify-path outcome.
      setState('editing');
      setEmailError(messageFor(null));
      setFocusTarget('email');
    } catch (error) {
      setState('editing');
      setEmailError(messageFor(error));
      if (isRateLimited(error)) startCooldown();
      setFocusTarget('email');
    }
  };

  const handleVerify = async () => {
    if (state === 'verifying') return;
    const check = checkCode(codeInput);
    if (check === 'incomplete') {
      // No api call. The section KNOWS locally that it never sent this code, so
      // rendering the server's "that code isn't right" would report the result
      // of a round trip that did not happen.
      setCodeError(INCOMPLETE_CODE_ERROR);
      return;
    }
    if (check === 'out-of-alphabet') {
      setCodeError(OUT_OF_ALPHABET_ERROR);
      return;
    }
    if (!selfId) return;

    setCodeError(null);
    setState('verifying');
    try {
      const body = await usersAPI.verifyEmailChange(selfId, normaliseEmailChangeCode(codeInput));
      if (!isUsableMutationBody(body)) {
        setState('awaiting-code');
        clearCodeField();
        setCodeError(messageFor(null));
        setFocusTarget('code');
        return;
      }
      applyToCache(body);
      clearCodeField();

      if (body.outcome === 'verified') {
        sentThisSessionRef.current = false;
        setState('verified');
        setSentLine(null);
        setResendPromoted(false);
        setNotice(null);
        toast.success(CHANGED_RECEIPT);
        setFocusTarget('change');
        return;
      }
      setState('awaiting-code');
      if (body.outcome === 'expired') {
        setCodeError(EXPIRED_CODE_ERROR);
        setResendPromoted(true);
      } else if (body.outcome === 'address_taken') {
        // NAMED, never collapsed into `invalid`. Plan 09 leaves the code row
        // active, so the same code still works if the conflict is resolved.
        setCodeError(ADDRESS_TAKEN_ERROR);
      } else {
        setCodeError(INVALID_CODE_ERROR);
      }
      setFocusTarget('code');
    } catch (error) {
      setState('awaiting-code');
      clearCodeField();
      setCodeError(messageFor(error));
      if (isRateLimited(error)) startCooldown();
      setFocusTarget('code');
    }
  };

  const handleResend = async () => {
    if (state === 'verifying') return;
    if (cooldown) {
      setCodeError(RESEND_COOLDOWN_ERROR);
      return;
    }
    if (!selfId) return;
    setCodeError(null);
    try {
      const body = await usersAPI.resendEmailChangeCode(selfId);
      if (!isUsableMutationBody(body)) {
        setCodeError(messageFor(null));
        return;
      }
      applyToCache(body);
      sentThisSessionRef.current = true;
      if (body.verification_sent) {
        setSentLine(
          `We sent a code to ${body.pending_email_change?.address ?? pendingAddress ?? ''}`.trim()
        );
        setNotice(null);
        setResendPromoted(false);
        startCooldown();
      } else {
        setSentLine(null);
        setNotice({ tone: 'error', text: MAIL_REFUSED_COPY });
        setResendPromoted(true);
      }
    } catch (error) {
      setCodeError(messageFor(error));
      if (isRateLimited(error)) startCooldown();
    }
  };

  const handleDiscard = async () => {
    if (!selfId) return;
    try {
      const body = await usersAPI.cancelEmailChange(selfId);
      if (!isUsableMutationBody(body)) {
        setCodeError(messageFor(null));
        return;
      }
      applyToCache(body);
      sentThisSessionRef.current = false;
      clearCodeField();
      setCodeError(null);
      setSentLine(null);
      setResendPromoted(false);
      setNotice(null);
      setState('idle');
      toast.success(DISCARDED_RECEIPT);
      setFocusTarget('change');
    } catch (error) {
      setCodeError(messageFor(error));
    }
  };

  const handleRevert = async () => {
    if (!selfId) return;
    setRevertError(null);
    try {
      const body = await usersAPI.revertEmailToSignIn(selfId);
      if (!isUsableMutationBody(body)) {
        setRevertError(messageFor(null));
        setFocusTarget('revert');
        return;
      }
      applyToCache(body);
      if (body.outcome === 'reverted') {
        setState('idle');
        setNotice(null);
        toast.success(REVERTED_RECEIPT);
        /* THIS CONTROL DELETES ITSELF ON SUCCESS, WHICH IS WHY THE FOCUS MOVE
           IS EXPLICIT. The affordance renders only while
           `self.email_changed_at` is non-null; plan 09 returns
           `email_changed_at: null` on `outcome: 'reverted'` and the line above
           patches that into the cache — so the button the user just activated
           is gone on the next paint. React does not relocate focus when the
           active element unmounts; the browser drops it to `<body>`, which on
           this page returns a keyboard or switch user to the top of a long
           profile with no announcement that anything happened. Change is the
           target because it is present in the idle state we land in, it is
           inside this section, and it is the SAME target a successful Verify
           and a Discard use — so all three completions behave identically. */
        setFocusTarget('change');
        return;
      }
      if (body.outcome === 'address_taken') {
        setRevertError(ADDRESS_TAKEN_ERROR);
      } else {
        setRevertError(messageFor(null));
      }
      // A FAILED revert leaves `email_changed_at` untouched, so the control is
      // still mounted: leave the user standing on the control that failed.
      setFocusTarget('revert');
    } catch (error) {
      setRevertError(messageFor(error));
      setFocusTarget('revert');
    }
  };

  /* ── RENDER ──────────────────────────────────────────────────────────────
     ARMS 1 AND 2 APPLY ONLY BEFORE HYDRATION HAS RUN. Once the section has
     hydrated it owns its own state and must never be thrown back to
     `unresolved` or `unavailable` by a later query flag — that would discard a
     code the user is halfway through typing. In practice the hook cannot
     re-enter those flags (`staleTime: Infinity`, and its docblock states the
     self row "NEVER self-refreshes"), so this is a guard against a future change
     to the hook rather than against today's behaviour. */
  const preHydration = !hydratedRef.current;
  const showUnavailable = state === 'unavailable' || (preHydration && selfQuery.isError);
  const showUnresolved = !showUnavailable && (state === 'unresolved' || (preHydration && !self));

  if (showUnavailable) {
    return (
      <section className="card p-3 md:p-6 mb-6" aria-labelledby={`${reactId}-title`}>
        <h2 id={`${reactId}-title`} className="text-xl font-bold text-content-primary mb-1">
          {SECTION_TITLE}
        </h2>
        {/* NO fallback to the Auth0 session address here. The profile page's own
            terminal arm does exactly that at page.js:809-821 — for the USERNAME,
            where a wrong display name is cosmetic. For the ADDRESS it is the
            stale value this whole correction removes, and offering Change
            against an address we cannot read invites a change to the value the
            user may already have. NO actions in this arm. */}
        <p className="text-sm text-content-secondary">{UNAVAILABLE_COPY}</p>
      </section>
    );
  }

  if (showUnresolved) {
    return (
      <section className="card p-3 md:p-6 mb-6" aria-labelledby={`${reactId}-title`}>
        <h2 id={`${reactId}-title`} className="text-xl font-bold text-content-primary mb-1">
          {SECTION_TITLE}
        </h2>
        {/* Visually quiet on purpose — a sub-second state on a warm cache. No
            address text, no Change, no revert affordance: rendering idle here
            would paint an empty address beside a live Change action and then
            rearrange itself under the user. */}
        <p className="text-sm text-content-muted">{UNRESOLVED_COPY}</p>
      </section>
    );
  }

  const inEditing = state === 'editing' || state === 'saving';
  const inAwaiting = state === 'awaiting-code' || state === 'verifying';
  const saveGated = state === 'saving' || emailInput.trim().length === 0;
  const verifyGated = state === 'verifying' || checkCode(codeInput) !== 'ok';

  return (
    <section className="card p-3 md:p-6 mb-6" aria-labelledby={`${reactId}-title`}>
      <h2 id={`${reactId}-title`} className="text-xl font-bold text-content-primary mb-1">
        {SECTION_TITLE}
      </h2>
      {/* The helper line must NOT, in the synthetic arm, claim that mail reaches
          that address — a second module-level constant rather than an
          interpolation of the normal one. */}
      <p className="text-sm text-content-muted mb-3">
        {currentIsSynthetic ? SYNTHETIC_HELPER : SECTION_HELPER}
      </p>

      {notice && (
        <Banner tone={notice.tone} className="mb-3">
          {notice.text}
        </Banner>
      )}

      {/* ── The current address ───────────────────────────────────────────── */}
      <div className="mb-3">
        <p className="text-xs text-content-muted">{CURRENT_ADDRESS_LABEL}</p>
        <p className="text-base text-content-primary break-words">
          {/* THE IDLE STATE MUST NOT PRINT A SENTINEL AS AN ADDRESS. The backend
              stores `<sub>@auth0.local` in `Users.email` as a SENTINEL, not a
              contact handle, and guards it in 19 places; this frontend guarded
              it in zero until this plan. Cite: DECISION Phase 88.2 NIX-AUTH0
              (services/groupOwnershipOfferService.js:97-114) — the BROAD
              `@auth0` substring is deliberate and re-narrowing it to
              `@auth0.local` is a decision, not a cleanup. A falsy address takes
              the same branch: "no address" and "a sentinel" read identically to
              the user, and only one of them is safe to print. */}
          {currentAddress && !currentIsSynthetic ? currentAddress : NO_ADDRESS_ON_FILE}
        </p>
      </div>

      {/* ── IDLE / VERIFIED ───────────────────────────────────────────────── */}
      {(state === 'idle' || state === 'verified') && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button ref={changeRef} variant="ghost" onClick={handleChange} className="max-md:min-h-11">
            {LABEL_CHANGE}
          </Button>
          {/* DECISION Phase 88.8 D-38: the revert affordance is keyed on
              `self.email_changed_at` and is ABSENT from the DOM when that is
              null — chosen OVER rendering it permanently inert. A user who has
              never changed their address has nothing to revert TO that differs
              from what they already have, and a permanently-inert control is
              worse than no control: it advertises an action that can never work.

              A SYNTHETIC idle state therefore renders no revert affordance, and
              that is a CONSEQUENCE of this keying rather than a missing feature:
              `email_changed_at` is null on those rows by construction — nobody
              has changed the address, which is exactly why it is still the
              provisioning sentinel. Do not add a revert control for a user with
              nothing to revert to. */}
          {hasChangedBefore && (
            <Button
              ref={revertRef}
              variant="ghost"
              onClick={handleRevert}
              className="max-md:min-h-11"
            >
              {LABEL_REVERT}
            </Button>
          )}
        </div>
      )}
      {(state === 'idle' || state === 'verified') && hasChangedBefore && (
        <p className="text-xs text-content-muted mt-1">{REVERT_HELPER}</p>
      )}
      {revertError && (
        <p role="alert" className="text-content-status-error text-xs mt-1">
          {revertError}
        </p>
      )}

      {/* ── EDITING / SAVING ──────────────────────────────────────────────── */}
      {inEditing && (
        <div>
          <FormField label="New email address" htmlFor={emailFieldId} error={emailError ?? undefined}>
            {/* The house form-field rule at `Input.tsx:11-19`: id + name + an
                associated label on every control, because browser autofill does
                not read ARIA. `FormField` injects the id and the aria
                attributes but NOT `name`. */}
            <Input
              ref={emailInputRef}
              id={emailFieldId}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={emailInput}
              /* Validation runs on Save (and on blur), NEVER on change:
                 `FormField`'s error slot is unconditionally `role="alert"`
                 (FormField.tsx:104-108), and an alert on every keystroke talks
                 over the person mid-entry. The phone block above records
                 exactly this reason at page.js:1524-1533. */
              onChange={(e) => setEmailInput(e.target.value)}
              onBlur={() => {
                const v = emailInput.trim();
                if (v && !EMAIL_SHAPE.test(v)) setEmailError(MALFORMED_EMAIL_ERROR);
              }}
            />
          </FormField>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 mt-2">
            <Button
              variant="primary"
              onClick={handleSave}
              aria-disabled={saveGated ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_SAVE}
            </Button>
            <Button variant="ghost" onClick={handleCancelEdit} className="max-md:min-h-11">
              {LABEL_CANCEL}
            </Button>
          </div>
        </div>
      )}

      {/* ── AWAITING CODE / VERIFYING ─────────────────────────────────────── */}
      {inAwaiting && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            {/* The state lives in a TEXT node (WCAG 1.4.1) — never colour and
                never an icon alone. `Icon` is `aria-hidden` by default
                (Icon.tsx:7), so the word is what is announced. */}
            <Icon name="Clock" size={16} className="text-content-status-warning shrink-0" />
            <span className="text-sm text-content-primary">{NOT_VERIFIED_LABEL}</span>
          </div>
          <p className="text-base text-content-primary break-words mb-2">{pendingAddress}</p>

          {/* Empty-first status region. Resend is a SIBLING of it, never inside
              it — a control inside a live region is re-announced whenever the
              region's text changes. */}
          <StatusRegion className="text-content-secondary mb-2">{sentLine ?? ''}</StatusRegion>

          <FormField
            label="Code from the email"
            htmlFor={codeFieldId}
            error={codeError ?? undefined}
            hint={
              <p id={codeHintId} className="text-xs text-content-muted mt-1">
                {CODE_FORMAT_HINT}
              </p>
            }
          >
            {/* THE FORMAT INSTRUCTION IS ASSOCIATED, NOT MERELY ADJACENT. BOTH
                halves are required: `FormField` renders `hint` at :103 but never
                puts it into `aria-describedby` (:79-83), so `hint` alone is
                decorative to assistive technology; and `FormField` MERGES the
                child's own `aria-describedby` into the computed value rather
                than overwriting it, so setting it here keeps the hint associated
                while still letting the error id join it when an error appears.
                Without this, a user who cannot see the field is told nothing
                about length, alphabet or whether the dash matters — on the one
                control in this section that rejects input on all three grounds. */}
            <Input
              ref={codeInputRef}
              id={codeFieldId}
              name="email_change_code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={9}
              aria-describedby={codeHintId}
              className="uppercase"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
            />
          </FormField>

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 mt-2">
            <Button
              variant="primary"
              onClick={handleVerify}
              aria-disabled={verifyGated ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_VERIFY}
            </Button>
            <Button
              ref={resendRef}
              /* The cooldown keeps the label STATIC and sets `aria-disabled`,
                 with the re-press blocked in the handler (DR-C). NO ticking
                 countdown text lives inside any Banner or StatusRegion —
                 `Banner` wraps its children in an assertive `aria-atomic`
                 region (Banner.tsx:87, :103-109), so a per-second label change
                 would re-announce the whole banner. */
              variant={resendPromoted ? 'secondary' : 'ghost'}
              onClick={handleResend}
              aria-disabled={cooldown ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_RESEND}
            </Button>
            <Button variant="ghost" onClick={handleDiscard} className="max-md:min-h-11">
              {LABEL_DISCARD}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* DECISION Phase 88.8 D-30: this section is built from the HOUSE primitives —
   `FormField`, `Input`, `Button`, `Banner`, `StatusRegion`, `Icon` — chosen OVER
   matching the phone-verification block that sits directly above it on the same
   page (`userProfile/page.js:1480-1680`). Copying the neighbour for local
   visual consistency is the obvious move and it LOSES here: that block's buttons
   are hand-rolled markup carrying neither the shared `.btn` class nor any height
   floor, so mirroring it would ship a phone-forward regression on a brand-new
   surface, on the one viewport this app is actually used on. What IS worth
   copying from it — and is copied — is its multi-state shape and its resend
   cooldown. Converging this section onto the neighbour's markup is a decision,
   not a cleanup; the correct direction of travel is the other way. */

/* DECISION Phase 88.8 DR-C (re-scoped 2026-09-04, plan review round 4): NO
   control in this section ever carries the native `disabled` attribute — not in
   flight, not during a cooldown, and not as a validity gate — chosen OVER using
   the native attribute anywhere. Every gate is `aria-disabled="true"` with the
   press blocked in the HANDLER and a fixed field error naming what is missing.

   WHY. A natively-disabled element is removed from the focus order. Verify sits
   immediately after the code input in the tab order and is the ONLY thing a
   keyboard user reaches by tabbing out of that field; disabling it natively
   until 8 valid symbols are present removes it for the whole time the user is
   typing, and a screen-reader user tabbing forward from a partly-typed code
   lands past the section with no announcement of why. That is a keyboard dead
   end reached by the NORMAL path, not an edge case. The same argument applies
   to Save's empty-field gate, so it is treated identically rather than left as a
   second instance of the class.

   THE PRECEDENT IS HONOURED, NOT OVERTURNED. `DECISION Phase 88.5` at
   `NextGameNightCard.tsx:379-390` splits it as: the control being ACTED ON gets
   `aria-disabled`; a control nobody is standing on may be natively disabled.
   There, the natively-disabled buttons are the OTHER RSVP options while one is
   submitting. This section simply has no control of that second kind.

   Note for whoever maintains this next, so it is not mis-applied one element
   over: `aria-disabled` on the `<input>` itself would not prevent typing and is
   NOT used here — the gate lives on the BUTTON, and both inputs stay ordinary
   editable fields throughout. Restoring native `disabled` on any control here is
   a decision, not a cleanup. */
