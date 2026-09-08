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
 *     `email`, `email_changed_at`, `pending_email_change`, and the server-computed
 *     `revert_available` (round 2 HIGH-B). The section issues no
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
import * as Sentry from '@sentry/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { FormField } from './form/FormField';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import type { FetchErrorMessageOptions } from '@/components/ui/useFetchErrorState';
import { ApiError, usersAPI } from '@/lib/api';
import { invalidateSelfCache, patchSelfCache } from '@/lib/hooks/selfIdentityCache';
import { useSelfIdentity } from '@/lib/hooks/useSelfIdentity';
import { EmailChangeResponseSchema } from '@/lib/schemas/users';
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
/* Round 5 #22: the arm where the section CANNOT KNOW whether the server acted.
   `isUsableMutationBody` is false for a transport failure BEFORE the server ran (the
   code is untouched and still live for its 30 minutes) AND for a 200 whose body failed
   the schema — where `consumeByNonce`'s single atomic UPDATE has already burnt the
   nonce. The honest copy names the retry AND the escape hatch, and never claims the
   code is still good: press Verify again, and if that fails the code is spent, so
   Resend is the way out. */
const UNREADABLE_ANSWER_ERROR =
  "We couldn't read the answer. Press Verify once more — if it fails again, use Resend code to get a fresh one.";
const EXPIRED_CODE_ERROR = 'That code has expired';
const ADDRESS_TAKEN_ERROR =
  'Another account already uses that address. Try a different one, or ask us for help if it should be yours.';
const RATE_LIMITED_ERROR = "You've asked for too many codes. Try again in a little while.";
const RESEND_COOLDOWN_ERROR = 'You can ask for another code in a moment';
/* Round 3 #34/#35: the in-flight gate ANSWERS. DR-C's contract is "every gate is
   aria-disabled with the press blocked in the handler AND a fixed error naming what is
   missing" — the validity gates and the cooldown all did; the `mutating` gate returned
   bare, so a keyboard or switch user who reached a control announced as unavailable and
   pressed it got nothing back for a whole network round trip. */
const ACTION_BUSY_ERROR = 'Wait for the current step to finish, then try again';
const TOO_LONG_EMAIL_ERROR = 'That email address is too long';
/* Round 5 #16/#19/#29: the address the BACKEND refuses because its own sentinel
   predicate matches it (`isSyntheticAddress` — any host containing "auth0", the broad
   NIX-AUTH0 test). Storing such a value would make seventeen backend sites and four
   frontend ones read a real address as a provisioning sentinel, so the refusal is
   correct — but it arrived as a bare `validation` envelope, which this section maps to
   "reload the page", and reloading changes nothing: the same input fails identically
   forever with no statement of what is wrong. This is the sentence that was missing. */
const RESERVED_ADDRESS_ERROR =
  "We can't use an address at that domain — it's reserved by our sign-in system. Try another address.";
/* Round 4 #19: the five handlers used to `return` silently when the self row carried no
   id — a dead button with no message. It is a contract failure, said as one. */
const SELF_UNAVAILABLE_ERROR = "We couldn't load your account details — reload the page and try again";
const MAIL_REFUSED_COPY =
  "We couldn't send the code just now. Your change is still waiting — use Resend code to try again.";
const UNCHANGED_COPY = "That's already the address we use for you";
/* Round 5 #2: a Save that was already in flight when the user pressed Cancel. The
   request cannot be unsent — the server has minted the pending change and mailed the
   code — so the section says so instead of pretending nothing happened, and instead of
   dragging the user into a panel they just left. Reloading re-runs the one-shot
   hydration off the self row, which lands them in awaiting-code with Resend available. */
const CANCELLED_MID_SAVE_COPY =
  'You cancelled, but the request had already reached us. Nothing has changed yet — reload the page to finish it, or leave it and it will expire.';
/* THE SAME CASE, WITH THE MAIL REFUSED (round 6 #12 as re-worded 2026-09-07). The first
   version of this arm reused MAIL_REFUSED_COPY, which ends "use Resend code to try
   again" — and Resend lives in the awaiting-code panel, which this arm does not land in.
   VERIFIED rather than assumed: hydration is one-shot and ref-guarded (`:513`), so the
   `invalidateSelfCache` refetch above brings back a row carrying `pending_email_change`
   and the section STAYS IDLE; only a reload re-runs the hydration that reads it. So the
   copy names a reload, which is the one action that actually reaches the code from here.
   Two constants rather than one interpolation because "we sent it" and "we could not
   send it" are different facts and the user acts differently on each. */
const CANCELLED_MID_SAVE_UNSENT_COPY =
  "You cancelled, but the request had already reached us — and we couldn't send the code. Nothing has changed yet. Reload the page to pick it up and ask for a new code.";
const PENDING_ADDRESS_LABEL = 'The address waiting to be verified';
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
  // LENGTH IS TESTED FIRST AND ON BOTH SIDES (code review #8, 2026-09-05). This
  // read `< CODE_LENGTH`, so nine VALID symbols — reachable, the input allows
  // maxLength 9 — fell through to the alphabet test, which is an exact `{8}`
  // match, and the user was told "That code has a character we don't use" about
  // a code containing no such character. The wrong-length message is the honest
  // one for both too-short and too-long; the alphabet message now fires only
  // when the alphabet is genuinely the problem.
  if (normalised.length !== CODE_LENGTH) return 'incomplete';
  if (!CODE_ALPHABET.test(normalised)) return 'out-of-alphabet';
  return 'ok';
}

/* Deliberately permissive: the BACKEND owns address validation
   (`EMAIL_FORMAT`, routes/users.js), and a stricter client regex would reject
   addresses the server accepts — the same class of defect as an over-strict
   code gate. This catches only the obvious typo so the user is not made to wait
   for a round trip to be told there is no `@`. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
/* Round 3 #16: BOTH halves mirror the backend's validators — `EMAIL_FORMAT` and
   `EMAIL_MAX_LENGTH` in routes/users.js (the same pairing the `email`/`code` request
   keys already carry). The looser shape this replaced accepted `a@b..com` and had no
   cap, so those inputs skipped the field message here and came back as the backend's
   generic "Validation failed" envelope. Neither repo's CI can see the other. */
const EMAIL_MAX_LENGTH = 255;

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

/* Round 3 #22: the bodyless routes (resend with nothing pending, revert with nothing to
   revert or no verified claim) answer the `validation` envelope, and the shared copy
   for that code is form-validation prose ("Something looks off with that request") —
   wrong for a button press with no input. Overridden HERE, in this section's byCode
   map, never in the shared Record other surfaces consume. */
const STALE_ACTION_ERROR = 'That action is no longer available — reload the page to see the current state';

/**
 * The shared error copy for a thrown failure, with the NAMED envelopes overridden.
 *
 * `overrides` is PER CALL SITE and exists for exactly one reason (round 5 #29): the
 * `validation` envelope means different things on different routes of this one feature,
 * and a single section-wide mapping cannot be right for all of them. The bodyless routes
 * (resend / revert with nothing pending) genuinely mean "stale state", which is what the
 * section-wide default says. The Save route does NOT: every other `validation` it can
 * return is pre-gated client-side by the four checks in `handleSave` — and the shape and
 * length gates are the SAME regex and the SAME cap the backend applies
 * (`routes/users.js:960`, EMAIL_MAX_LENGTH 255), verified rather than assumed — so the
 * only refusal that can survive them is the synthetic-address gate.
 */
function messageFor(error: unknown, overrides: FetchErrorMessageOptions['byCode'] = {}): string {
  return getFetchErrorMessage(error, {
    byCode: { rate_limited: RATE_LIMITED_ERROR, validation: STALE_ACTION_ERROR, ...overrides },
  });
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
  /* RUNTIME-VALIDATED SINCE 2026-09-05 (code review #16). The schema block in
     `lib/schemas/users.ts` says a `switch` here that misses an outcome literal is
     "a TYPE error rather than a runtime fall-through" — but that only holds if the
     value actually IS the declared type, and nothing checked. `apiFetch<T>` is a
     generic CAST, not a parse (`lib/api.ts:848`), and `EmailChangeResponseSchema`
     had zero call sites in the repo. So the stated safety net did not exist: a
     ninth outcome literal, or a body missing `verification_sent`, reached the UI
     unchallenged — exactly the silent fall-through the comment claims is
     impossible. Parsing here rather than in `lib/api.ts` keeps the blast radius at
     this one section instead of every apiFetch consumer.

     AND IT IS REPORTED (round 6 #4). Until now the only consequence of a drifted body
     was a sentence to the user that reads like a transient blip — "press Verify once
     more", "something went wrong" — while the actual event, a backend contract this
     client can no longer parse, reached nobody. That is the one failure class here that
     no user action can fix and that gets WORSE the longer it is invisible.

     REPORTED FROM THE PREDICATE, not from the five call sites, because there is one rule
     and duplicating it five times is how the five drift apart.

     WHAT GOES TO SENTRY, AND WHY IT IS SAFE: a wrapped Error naming the failure, tags,
     and the zod issues reduced to `{path, code}` — the T-84-05 shape already reviewed and
     shipped at `queryClient.ts:150-157`, whose comment states the reason: an issue's
     `received` field can carry the input value, which on THIS route is the user's email
     address. The raw ZodError is never forwarded. `path` is a schema key name and `code`
     is a zod enum; neither can carry a value. */
  const parsed = EmailChangeResponseSchema.safeParse(body);
  if (!parsed.success) {
    Sentry.captureException(new Error('email-change response schema drift'), {
      tags: { feature: 'email-change', op: 'schema-drift' },
      extra: { zodIssues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    });
    return false;
  }
  if ((body?.email?.length ?? 0) > 0) return true;
  /* The SECOND drift shape, distinct from a parse failure: the schema permits a null
     `email` (the backend answers it when it could not re-read the row), but this section
     treats it as a contract error on a MUTATION — see the schema's own comment. Named
     separately so the two are not one indistinguishable alarm. */
  Sentry.captureException(new Error('email-change response carried no address'), {
    tags: { feature: 'email-change', op: 'schema-drift' },
  });
  return false;
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
  /* DECISION Phase 88.8 (code review HIGH-2, 2026-09-05): ONE in-flight lane for the
     three secondary actions, and every handler consults `state` as well — chosen OVER
     a per-button flag, which is what the first implementation effectively had (none at
     all) and which leaves the controls unable to see each other. The cross-lane clause
     is the load-bearing half: Discard rendered live during a `verifying` round trip,
     and POST /email/cancel revokes the very token the verify is consuming, so the user
     was told "That code isn't right" about a code that was right — the exact false
     report this section's docblock says it exists to prevent. Per DR-C the press is
     blocked in the HANDLER and the control stays MOUNTED and focusable under
     `aria-disabled`; it never carries the native `disabled` attribute. */
  const [busy, setBusy] = React.useState<null | 'resend' | 'discard' | 'revert'>(null);
  /* ONE ALWAYS-MOUNTED ANNOUNCEMENT LANE (code review #32/#33, 2026-09-05).
     `StatusRegion`'s own contract is EMPTY-FIRST — "screen readers announce
     CHANGES to a live region, not the conditional mount of a new one"
     (StatusRegion.tsx docblock). Both of this section's live surfaces broke it by
     being conditionally mounted WITH their content already present: the sent-code
     line lives inside the `inAwaiting &&` block, and the `unchanged` Banner is
     `{notice && <Banner …>}`. So pressing Save and landing on "That's already the
     address we use for you" announced NOTHING (WCAG 4.1.3), and neither did the
     first "We sent a code to …".
     This region is mounted for the section's whole life and speaks for the messages
     whose visible home CANNOT announce — the plain-text sent line and the info Banner
     (a polite region that is conditionally mounted). AMENDED round 3 #38: it does NOT
     double what already announces — an error-tone Banner is an assertive live region
     of its own, and the toaster is a permanently mounted polite region — so the
     refused-mail copy and the discard receipt are no longer announce()d here. One
     rule: each message is announced exactly once, by whichever surface owns it. Chosen OVER making `Banner` itself always-mounted,
     which would paint an empty coloured box, and OVER changing the `Banner`
     primitive to take a `live={false}` prop — Banner has consumers well outside
     this phase and that is a shared-surface change this finding does not justify. */
  const [announcement, setAnnouncement] = React.useState('');
  /* A REPEAT Resend re-set a byte-identical string, so React rendered nothing and
     the region never changed — the second half of #32. Handled by giving Resend
     its own wording (`We sent a NEW code to …`) rather than by a clear-then-set
     timer: a timer would make every announcement asynchronous, which is worse to
     test and worse to reason about, for a case the 30-second cooldown already
     rate-limits. RESIDUAL, stated rather than hidden: two resends to the SAME
     address more than 30s apart announce identical text, and the second is
     silent. The visible line and the toast still change. */
  const announce = setAnnouncement;
  /* Failures of Resend / Discard / Revert used to be written into `codeError`,
     which `FormField` turns into `aria-invalid="true"` on the code input — marking
     a field the user has not mistyped, and often has not touched (code review #35).
     Those failures are about the ACTION, not the field, so they get their own lane. */
  const [actionError, setActionError] = React.useState<string | null>(null);
  /* THE EDITING BLOCK'S OWN ACTION LANE (round 5 #35/#39). The rule one lane up applies
     verbatim here and the editing block had no surface to apply it to: Cancel's busy gate
     and Save's missing-self-row gate were written into `emailError`, which `FormField`
     turns into `aria-invalid="true"` on the email input — telling assistive tech the
     address the user typed is wrong when the address is not the problem at all (WCAG
     4.1.2). `emailError` now carries ONLY the field's own verdicts (empty, too long,
     malformed, and the reserved-domain refusal); everything that is a fact about the
     ACTION lands here, beside the buttons, exactly as `actionError` does for the
     awaiting-code block and `revertError` for the idle one. */
  const [editActionError, setEditActionError] = React.useState<string | null>(null);
  /* THE SAVE REQUEST, NOT THE SAVE STATE (round 6 HIGH). `state === 'saving'` stops being
     true the instant Cancel is pressed — that is the whole point of Cancel — so the lane
     `mutating` describes fell OPEN while the POST was still on the wire, and Change,
     Save, Revert, Resend and Discard all became pressable against a live request. The
     request needs a flag of its own that outlives the state the user left. Set before the
     await and cleared in `finally`, so it tracks the REQUEST rather than the panel.
     DELIBERATELY ABSENT FROM `cancelGated` AND FROM CANCEL'S HANDLER GATE: Cancel is the
     one control that is allowed to interrupt its own Save, which is the fix this flag
     protects, not one it should undo. */
  const [saveInFlight, setSaveInFlight] = React.useState(false);
  const mutating = busy !== null || saveInFlight || state === 'saving' || state === 'verifying';
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
  /* THE SAVE LANE'S RUN TOKEN (round 5 #2). Bumped when a Save starts AND when Cancel is
     pressed, so a landing response can tell whether the user is still standing in the
     panel that asked for it. This is what makes Cancel-during-Save safe to ALLOW rather
     than to gate: the harm round 4 described was never the press, it was the response
     re-entering awaiting-code and stealing focus afterwards. */
  const saveRunRef = React.useRef(0);
  /* LAST WRITE WINS (round 6 HIGH). The run whose response has already been written into
     the immortal self cache. An older run that lands later must never patch its row back
     over a newer one — `staleTime: Infinity` means the wrong row would then survive the
     whole session. Defensive today (a newer Save bumps `saveRunRef`, which makes every
     older run `abandoned` before it reaches the patch) and kept because the invariant is
     the thing that must hold, not the current spelling of the branch above it. */
  const appliedSeqRef = React.useRef(0);
  /* The state as of LANDING TIME, not as of the closure. A response resolves long after
     the render that started it, and the user may be in a different panel by then — see
     the abandoned arm, which must not fire a notice into a session it is not about. */
  const stateRef = React.useRef<SectionState>(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);
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
  /* SURVIVES A NULL CACHE PATCH (code review #1, 2026-09-05). On `outcome:
     'expired'` the server's body carries `pending_email_change: null` — its loader
     filters on `expires_at > now()`, and an expired row fails that — and
     `applyToCache` writes that null into the immortal self cache. The awaiting
     panel then rendered "Not verified yet" above an EMPTY address line at the exact
     moment the user is being asked to re-verify that address. Remembering the last
     non-null value keeps the address on screen; the cache stays the source of
     truth whenever it HAS one. */
  const livePendingAddress = self?.pending_email_change?.address ?? null;
  const lastPendingAddressRef = React.useRef<string | null>(null);
  if (livePendingAddress) lastPendingAddressRef.current = livePendingAddress;
  const pendingAddress = livePendingAddress ?? lastPendingAddressRef.current;
  /* The revert affordance is gated on the SERVER's answer, never on
     `email_changed_at` alone (code review round 2 HIGH-B, owner ruling
     2026-09-05). The revert route also demands a verified, non-synthetic claim
     on the ACCESS token, which this component cannot read — `useUser()` exposes
     the SESSION token, and the two disagree exactly during the wave-8 window —
     so a client-side gate here was advertising an action the route refused.
     `=== true` is the whole gate: `null` (a default-scope echo), `false` and an
     ABSENT key all fail CLOSED. Do not loosen this to a truthiness check. */
  const revertAvailable = self?.revert_available === true;

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
        revert_available: body.revert_available,
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
    // Round 3 #35: Change is a lane consumer too — pressed during an in-flight Revert it
    // moved the section to editing, which the resolving revert then stomped back to idle,
    // destroying a half-typed address with no announcement.
    if (mutating) {
      setRevertError(ACTION_BUSY_ERROR);
      return;
    }
    setEmailInput('');
    setEmailError(null);
    setEditActionError(null);
    setNotice(null);
    setRevertError(null);
    setState('editing');
    setFocusTarget('email');
  };

  const handleCancelEdit = () => {
    /* DECISION Phase 88.8 post-merge #2: Cancel WORKS during an in-flight Save, and the
       landing response is what gets blocked — chosen OVER round 4's gate, which refused
       the press. The gate closed nothing: the outcome it cited ("the landing response
       yanks the user into awaiting-code, stealing focus into a panel they had just
       left") happened anyway, because `handleSave` still ran its success path when the
       request resolved. All the gate removed was the user's ability to SAY they wanted
       out — and with `apiFetch` carrying no AbortSignal and no timeout
       (`lib/api.ts`), a stalled Save left both Save and Cancel refused with no exit
       from the editing panel short of a page reload. Bumping the run token records the
       intent; the landing response honours it below. Restoring the gate is a decision,
       not a cleanup.

       AMENDED (round 6 HIGH, 2026-09-07) — THE SHAPE IS NOW THREE PARTS, and the first
       version shipped only one of them:
         1. Cancel works and moves the section to idle, as below.
         2. THE LANE STAYS CLOSED ANYWAY, on `saveInFlight` rather than on
            `state === 'saving'`. Leaving the section's state as the only lane signal
            meant `mutating` went false the moment Cancel landed, opening Change, Save,
            Revert, Resend and Discard against a POST that was still on the wire.
         3. AN ABANDONED RESPONSE REFETCHES, IT DOES NOT PATCH. It is by definition a
            response the section already knows is stale, and the self row is immortal.

       THE OTHER LANES STILL GATE THE PRESS. `busy` (Resend / Discard / Revert) and a
       `verifying` round trip are OTHER actions, not this one — Cancel cannot speak for
       them, so they answer with the busy line exactly as the five siblings do. Note what
       is deliberately NOT in this gate: `saveInFlight`. Cancel interrupting its own Save
       is the point; gating on it would restore round 4's defect through the back door. */
    if (busy !== null || state === 'verifying') {
      setEditActionError(ACTION_BUSY_ERROR);
      return;
    }
    saveRunRef.current += 1;
    setEmailError(null);
    setEditActionError(null);
    setState('idle');
    setFocusTarget('change');
  };

  const handleSave = async () => {
    // DR-C: the press is blocked in the HANDLER, and the gated control tells
    // the user what is missing rather than doing nothing.
    // Round 3 #1/#35: the lane is SYMMETRIC — Save consults `mutating`, not only its
    // own state, so a Save pressed while a Revert is in flight cannot start an edit the
    // resolving revert then stomps back to idle. And it answers (#34).
    if (mutating) {
      // Round 5 #35: the same class as Cancel's gate — a fact about the LANE, never a
      // verdict on the typed address, so it must not stamp aria-invalid on the input.
      setEditActionError(ACTION_BUSY_ERROR);
      return;
    }
    const value = emailInput.trim();
    if (!value) {
      setEmailError(EMPTY_EMAIL_ERROR);
      return;
    }
    if (value.length > EMAIL_MAX_LENGTH) {
      setEmailError(TOO_LONG_EMAIL_ERROR);
      return;
    }
    if (!EMAIL_SHAPE.test(value)) {
      setEmailError(MALFORMED_EMAIL_ERROR);
      return;
    }
    /* Round 5 #16/#19/#29: THE SAME PREDICATE THE BACKEND USES, not a re-spelling of it.
       `isSyntheticAddress` is the shared `src/lib/syntheticAddress.ts` helper this file
       already consumes for the idle display, and it pairs with
       `services/provisioningService.js:142-147`. Do NOT narrow either side to
       `@auth0.local` — `DECISION Phase 88.2 NIX-AUTH0` records the broad substring as
       deliberate. The one documented divergence (this copy answers FALSE for
       null/empty, the backend answers TRUE) cannot bite here: `value` is non-empty by
       the check three lines up, and harmonising the two is a decision, not a cleanup.
       Checked BEFORE the request so the answer is immediate and attached to the field,
       the same shape as the three pre-flights above it. */
    if (isSyntheticAddress(value)) {
      setEmailError(RESERVED_ADDRESS_ERROR);
      return;
    }
    if (!selfId) {
      // Round 5 #35: "we couldn't load your account details" is a fact about the SECTION,
      // not about the address in the field.
      setEditActionError(SELF_UNAVAILABLE_ERROR);
      return;
    }

    setEmailError(null);
    setEditActionError(null);
    setNotice(null);
    setState('saving');
    const run = ++saveRunRef.current;
    try {
      setSaveInFlight(true);
      const body = await usersAPI.requestEmailChange(selfId, value);
      /* Round 5 #2: the user pressed Cancel while this was in flight. Everything below
         moves the section and the focus, and doing any of it now would put them back in
         a panel they explicitly left. */
      const abandoned = saveRunRef.current !== run;
      if (!isUsableMutationBody(body)) {
        if (abandoned) return;
        setState('editing');
        setEmailError(messageFor(null));
        setFocusTarget('email');
        return;
      }
      if (abandoned) {
        /* REFETCH, NEVER PATCH (round 6 HIGH). The server DID act and the immortal self
           row must not stay stale — but this body is one the section already knows is
           out of date, and writing it wholesale was a real corruption: Save A stalls,
           Cancel, Change, Save B, B lands and the user is verifying B, then A lands late
           and patched `pending_email_change` (plus `email`, `email_changed_at` and
           `revert_available`) back to A underneath them. `staleTime: Infinity` means that
           wrong row then survives the entire session. A refetch cannot resurrect A over
           B: it asks the server what is true NOW, which is B. `patchSelfCache` stays on
           the non-abandoned path, where the body IS the freshest thing the client has.
           `invalidateSelfCache` is the module's existing helper for exactly this case
           ("the authoritative post-mutation state must come from the server"). */
        void invalidateSelfCache(queryClient);
        /* AND THE NOTICE ONLY SPEAKS INTO THE SESSION IT IS ABOUT. `stateRef` is read
           rather than the closure's `state`, which is frozen at the render that started
           this request: by landing time the user may have opened a new edit or be sitting
           in awaiting-code for a LATER save, and "you cancelled, but…" fired into that
           panel is a message about something else entirely. Idle is the one state this
           sentence belongs in. */
        if (body.outcome === 'code_sent' && stateRef.current === 'idle') {
          if (body.verification_sent) {
            setNotice({ tone: 'info', text: CANCELLED_MID_SAVE_COPY });
            announce(CANCELLED_MID_SAVE_COPY);
          } else {
            /* THE PROVIDER REFUSED THE MAIL (round 6 #12). Saying "reload the page to
               finish it" would point at a code that was never sent. The round-5 version
               of this line reused MAIL_REFUSED_COPY and carried a stated residual: its
               "use Resend code" names a control in the awaiting-code panel, and this arm
               lands in IDLE. That residual is now closed rather than documented — see the
               constant, which names the one action that works from here. Not announce()d:
               an error-tone Banner is an assertive live region of its own (round 3 #38),
               so the region would say it twice. */
            setNotice({ tone: 'error', text: CANCELLED_MID_SAVE_UNSENT_COPY });
          }
        }
        return;
      }
      /* LAST WRITE WINS. Defensive: any newer Save bumps `saveRunRef`, so an older run is
         already `abandoned` above and cannot reach this line. The guard states the
         invariant anyway, because what must hold is "no older response ever overwrites a
         newer one", not "the branch above currently happens to catch them all". */
      if (run >= appliedSeqRef.current) {
        appliedSeqRef.current = run;
        applyToCache(body);
      }

      if (body.outcome === 'unchanged') {
        /* STAY IN awaiting-code IF A CHANGE IS STILL PENDING (code review #5,
           2026-09-05). The server deliberately leaves an existing pending change
           alone on this outcome (`88.8-09-PLAN.md:202`, and revoking it would
           destroy a live verification on an ambiguous signal) — but the section
           used to drop to idle anyway while writing that still-live
           `pending_email_change` into the immortal self cache. The user read
           "cancelled"; the system meant "still pending"; and the one-shot
           hydration effect put the section back into awaiting-code for that other
           address on the next mount. The server was truthful and the client was
           not, so the client is what changed. */
        const stillPending = Boolean(body.pending_email_change);
        setState(stillPending ? 'awaiting-code' : 'idle');
        setNotice({ tone: 'info', text: UNCHANGED_COPY });
        announce(UNCHANGED_COPY);
        setSentLine(null);
        setFocusTarget(stillPending ? 'code' : 'change');
        return;
      }
      if (body.outcome === 'code_sent') {
        sentThisSessionRef.current = true;
        setState('awaiting-code');
        clearCodeField();
        setCodeError(null);
        if (body.verification_sent) {
          const line = `We sent a code to ${body.pending_email_change?.address ?? value}`;
          setSentLine(line);
          announce(line);
          setNotice(null);
          setResendPromoted(false);
          startCooldown();
        } else {
          // A mail the PROVIDER refused. Never the "code sent" line — the token
          // survives (the owner's 2026-09-04 ruling) so Resend is the remedy.
          setSentLine(null);
          // Not announce()d here (round 3 #38): an error-tone Banner is itself an
          // assertive live region, so the region would say it twice.
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
      // The cooldown is the SERVER's rate limiter and is armed either way.
      if (isRateLimited(error)) startCooldown();
      // Round 5 #2: a failure reported into a panel the user cancelled out of is noise
      // attached to a control that is no longer on screen.
      if (saveRunRef.current !== run) return;
      setState('editing');
      /* Round 5 #29 AS AMENDED BY ROUND 6 #11/#15/#16: the SERVER-side half of the same
         refusal, now keyed on the refusal's OWN code. The first version mapped the whole
         `validation` envelope on this route, reasoning that the client pre-flights left
         the synthetic gate as the only reachable cause — true, but it made every OTHER
         400 on the route (a body-key drift, a future validator) render as "the domain is
         reserved", which is a confident wrong answer rather than a generic one. The
         backend registered `unsupported_address` @400 in this same fix set
         (`utils/errors.js:104`), so the specific code now carries the specific copy and
         `validation` falls back to the section-wide stale-action default, exactly as it
         does on the four sibling routes. The pre-check above is unchanged and still means
         this should never fire from our own UI. */
      setEmailError(messageFor(error, { unsupported_address: RESERVED_ADDRESS_ERROR }));
      setFocusTarget('email');
    } finally {
      // The REQUEST is over either way, so the lane reopens either way — including on
      // the abandoned paths above, which return early out of the `try`.
      setSaveInFlight(false);
    }
  };

  const handleVerify = async () => {
    // Round 3 #1/#35: Verify consults the shared lane. Before this it guarded on its
    // own state only, so Resend-then-Verify let the verify race the resend's revoke and
    // the user was told "That code isn't right" about a code that was right — the exact
    // class HIGH-2 closed for the three secondary actions, left open on the primary one.
    if (mutating) {
      setActionError(ACTION_BUSY_ERROR);
      return;
    }
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
    if (!selfId) {
      setActionError(SELF_UNAVAILABLE_ERROR);
      return;
    }

    setCodeError(null);
    setState('verifying');
    try {
      const body = await usersAPI.verifyEmailChange(selfId, normaliseEmailChangeCode(codeInput));
      if (!isUsableMutationBody(body)) {
        // Round 4 #1: a contract/transport failure is NOT a verdict on the code — it is
        // still live for its 30 minutes — so the typed 8 characters are KEPT and Verify can
        // simply be pressed again. Clearing belongs to the outcome-bearing branch below.
        // ROUND 5 #22, THE RESIDUAL STATED RATHER THAN HIDDEN: that premise holds for a
        // failure BEFORE the server acted, which is the likelier of the two, but this
        // branch also catches a 200 whose body failed the schema — a request the server
        // DID process, whose atomic consume already burnt the nonce. Keeping the code is
        // still right (a re-press costs nothing and wins the common case), but the copy
        // must not imply the code is known-good, so it names Resend as the way out.
        setState('awaiting-code');
        setCodeError(UNREADABLE_ANSWER_ERROR);
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
        /* NAMED, never collapsed into `invalid` — telling this user their code "isn't
           right" would be false and would hide a real account conflict behind a retry
           prompt.

           AND THE CODE IS DELIBERATELY CLEARED HERE (owner ruling, 2026-09-07, round 6).
           This comment used to say plan 09 leaves the code row active "so the same code
           still works if the conflict is resolved", which read as an argument for keeping
           the typed characters — it is not. Resolving this conflict means leaving the
           page: the other account has to be dealt with, or we have to be asked for help.
           Nobody comes back to a still-mounted section with the same eight characters in
           the field, so preserving them helps nobody. The server's 30-minute grace is a
           COURTESY that keeps a re-verify possible, not a UI contract this section is
           obliged to hold state for. Contrast the transport arms above, where the retry
           is immediate and the code genuinely is the next keystroke. */
        setCodeError(ADDRESS_TAKEN_ERROR);
      } else {
        setCodeError(INVALID_CODE_ERROR);
      }
      setFocusTarget('code');
    } catch (error) {
      /* Round 5 #1: THE SAME RULE AS THE BRANCH ABOVE, which round 4 applied to the
         unparseable-body arm and left contradicted here. This is the branch that
         actually handles a dropped connection, a 5xx and a 429 — the cases where the
         server most likely never reached the code at all — and it was wiping the typed
         8 characters, forcing a re-transcription from the mail client on a phone. The
         code is KEPT and Verify can be pressed again; `messageFor(error)` names what
         actually failed and never claims the code is still valid. Resend stays mounted
         beside it for the residual case where the request did land. */
      setState('awaiting-code');
      setCodeError(messageFor(error));
      if (isRateLimited(error)) startCooldown();
      setFocusTarget('code');
    }
  };

  const handleResend = async () => {
    if (mutating) {
      setActionError(ACTION_BUSY_ERROR);
      return;
    }
    if (cooldown) {
      setActionError(RESEND_COOLDOWN_ERROR);
      return;
    }
    if (!selfId) {
      setActionError(SELF_UNAVAILABLE_ERROR);
      return;
    }
    setActionError(null);
    setBusy('resend');
    try {
      const body = await usersAPI.resendEmailChangeCode(selfId);
      if (!isUsableMutationBody(body)) {
        setActionError(messageFor(null));
        return;
      }
      applyToCache(body);
      sentThisSessionRef.current = true;
      if (body.verification_sent) {
        const line = `We sent a new code to ${
          body.pending_email_change?.address ?? pendingAddress ?? ''
        }`.trim();
        setSentLine(line);
        announce(line);
        setNotice(null);
        setResendPromoted(false);
        startCooldown();
      } else {
        setSentLine(null);
        setNotice({ tone: 'error', text: MAIL_REFUSED_COPY }); // announces itself (#38)
        setResendPromoted(true);
      }
    } catch (error) {
      setActionError(messageFor(error));
      if (isRateLimited(error)) startCooldown();
    } finally {
      setBusy(null);
    }
  };

  const handleDiscard = async () => {
    if (mutating) {
      setActionError(ACTION_BUSY_ERROR);
      return;
    }
    if (!selfId) {
      setActionError(SELF_UNAVAILABLE_ERROR);
      return;
    }
    setActionError(null);
    setBusy('discard');
    try {
      const body = await usersAPI.cancelEmailChange(selfId);
      if (!isUsableMutationBody(body)) {
        setActionError(messageFor(null));
        return;
      }
      applyToCache(body);
      sentThisSessionRef.current = false;
      clearCodeField();
      setCodeError(null);
      setActionError(null);
      setSentLine(null);
      setResendPromoted(false);
      setNotice(null);
      setState('idle');
      toast.success(DISCARDED_RECEIPT); // the toaster is a polite live region (#38)
      setFocusTarget('change');
    } catch (error) {
      setActionError(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const handleRevert = async () => {
    if (mutating) {
      setRevertError(ACTION_BUSY_ERROR);
      return;
    }
    if (!selfId) {
      setRevertError(SELF_UNAVAILABLE_ERROR);
      return;
    }
    setRevertError(null);
    setBusy('revert');
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
           `self.revert_available === true`; the backend answers a successful
           revert with `revert_available: false` (and `email_changed_at: null`)
           and the line above patches that into the cache — so the button the
           user just activated is gone on the next paint. React does not relocate focus when the
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
      // A FAILED revert leaves `email_changed_at` and `revert_available`
      // untouched, so the control is still mounted: leave the user standing on
      // the control that failed.
      setFocusTarget('revert');
    } catch (error) {
      setRevertError(messageFor(error));
      setFocusTarget('revert');
    } finally {
      /* Fires after a SUCCESSFUL revert has already unmounted its own button (the
         cache patch flips `revertAvailable` false). Harmless — the section itself
         is still mounted, so this is a state write on a live component, and it
         leaves the lane clean for the next action. */
      setBusy(null);
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

  /* Round 4 #29: the loading→failed transition happened in plain <p>s below the always-
     mounted region (which lived in the main return only), so it reached no assistive tech.
     The region is now rendered in BOTH early arms, the failure copy is announced through
     it, and the section is aria-busy while unresolved. */
  React.useEffect(() => {
    if (showUnavailable) setAnnouncement(UNAVAILABLE_COPY);
  }, [showUnavailable]);
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
        {/* ONE RENDERING OF THE SENTENCE, AND IT COMES AFTER THE HEADING (round 5 #36).
            Round 4 put the copy into an sr-only region AND left it in a visible <p>, so a
            screen-reader user heard it from the live region and then met it a second time
            in browse mode — against this file's own rule that "each message is announced
            exactly once, by whichever surface owns it". Worse, the region was child index
            0, so the failure sentence arrived BEFORE the <h2> that says which section
            failed. This is one node that is both the visible text and the live region.
            RESIDUAL, stated rather than hidden: it paints empty for the one frame before
            the effect above runs, which is the price of the empty-first contract — a
            region that mounts WITH its content announces nothing, and this arm can be the
            section's FIRST render when the self query is already settled-errored. */}
        <StatusRegion className="text-sm text-content-secondary">{announcement}</StatusRegion>
      </section>
    );
  }

  if (showUnresolved) {
    return (
      <section className="card p-3 md:p-6 mb-6" aria-labelledby={`${reactId}-title`} aria-busy="true">
        <h2 id={`${reactId}-title`} className="text-xl font-bold text-content-primary mb-1">
          {SECTION_TITLE}
        </h2>
        {/* Same read order as the arm above: the region follows the heading. It is empty
            in this state — nothing announces while loading — so this is consistency, not
            a fix; the arm it hands over to is where the sentence lands. */}
        <StatusRegion className="sr-only">{announcement}</StatusRegion>
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
  // Round 3 #35: the primary gates carry the lane, so their ARIA state is right exactly
  // when the one-lane contract says they are unavailable (WCAG 4.1.2).
  /* Round 5 #33: `!selfId` joins the gate expressions. Round 4 gave the self-row gate
     DR-C's SECOND half only (a fixed error naming what is missing) and not its first, so
     a screen-reader or switch user was told the control was available, pressed it, and
     got an error instead of an action. DR-C's contract is both halves together
     (`:123-127`), and the five controls already carry the shape for `mutating` and the
     cooldown — this is the same shape applied to the one condition that was missing it,
     not a new rule. Still `aria-disabled`, never native `disabled`. */
  const selfRowMissing = !selfId;
  /* Round 5 #2: Cancel's ARIA state mirrors ITS gate, which is no longer `mutating` —
     an in-flight Save is the one lane Cancel is allowed to interrupt, and announcing it
     as unavailable while the handler accepts the press would be the 4.1.2 mismatch DR-C
     exists to prevent. */
  const cancelGated = busy !== null || state === 'verifying';
  const saveGated = mutating || emailInput.trim().length === 0 || selfRowMissing;
  const verifyGated = mutating || checkCode(codeInput) !== 'ok' || selfRowMissing;

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

      {/* THE SECTION'S ONE LIVE REGION — mounted for the whole life of the section,
          empty until something happens, so every message is a CHANGE and therefore
          announced. Visually hidden because each message also has a visible home
          (the sent-code line, the Banner, a toast); this exists so the visible one
          does not have to be conditionally mounted to be heard. See the
          `announce()` docblock above for why the conditional mounts could not
          announce on their own. */}
      <StatusRegion className="sr-only">{announcement}</StatusRegion>

      {/* ── IDLE / VERIFIED ───────────────────────────────────────────────── */}
      {(state === 'idle' || state === 'verified') && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {/* DECISION Phase 88.8 D-30 AMENDED (owner ruling 2026-09-07, plan 14 production
              walk): Change and the revert below are `secondary`, chosen OVER the ghost D-30
              originally assigned them. On the idle row there is no primary beside them to
              anchor the row, and a borderless ghost read as a label — the owner could not
              tell it was a button. Cancel / Discard / un-promoted Resend STAY ghost: each
              sits beside a primary (Save / Verify) that anchors its row. Changing these two
              back to ghost is a decision, not a cleanup. */}
          <Button
            ref={changeRef}
            variant="secondary"
            onClick={handleChange}
            /* Round 6 #32: Change's gate writes ACTION_BUSY_ERROR into `revertError` —
               the idle block's lane, which is where its only sibling already points. */
            aria-describedby={revertError ? `${reactId}-revert-error` : undefined}
            aria-disabled={mutating ? 'true' : undefined}
            className="max-md:min-h-11"
          >
            {LABEL_CHANGE}
          </Button>
          {/* DECISION Phase 88.8 D-38: the revert affordance is ABSENT from the
              DOM when a revert is not available — chosen OVER rendering it
              permanently inert. A user who has never changed their address has
              nothing to revert TO that differs from what they already have, and
              a permanently-inert control is worse than no control: it
              advertises an action that can never work.

              AMENDED 2026-09-05 (code review round 2 HIGH-B, owner ruling): the
              key is the SERVER-computed `self.revert_available === true`, no
              longer `self.email_changed_at` alone. The route's precondition
              also reads the ACCESS token's claim, which this component cannot
              see, so keying on the timestamp rendered a control the route would
              refuse — the very "advertises an action that cannot work" this
              decision rejects. The server answers the route's own question and
              this gate fails CLOSED on null, false and absent.

              A SYNTHETIC idle state therefore renders no revert affordance, and
              that is a CONSEQUENCE of this keying rather than a missing feature:
              `email_changed_at` is null on those rows by construction — nobody
              has changed the address, which is exactly why it is still the
              provisioning sentinel — so the server answers false. Do not add a
              revert control for a user with nothing to revert to. */}
          {revertAvailable && (
            <Button
              ref={revertRef}
              variant="secondary"
              onClick={handleRevert}
              aria-describedby={revertError ? `${reactId}-revert-error` : undefined}
              aria-disabled={mutating || selfRowMissing ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_REVERT}
            </Button>
          )}
        </div>
      )}
      {(state === 'idle' || state === 'verified') && revertAvailable && (
        <p className="text-xs text-content-muted mt-1">{REVERT_HELPER}</p>
      )}
      {revertError && (
        <p id={`${reactId}-revert-error`} role="alert" className="text-content-status-error text-xs mt-1">
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
              onChange={(e) => {
                setEmailInput(e.target.value);
                // Round 3 #36: resuming entry clears the stale error (and its
                // aria-invalid); validation itself still runs only on Save and blur.
                if (emailError) setEmailError(null);
                // Round 5 #35: the action lane is cleared on the same keystroke, so a
                // stale busy line cannot outlive the step it was about.
                if (editActionError) setEditActionError(null);
              }}
              /* ENTER SUBMITS (code review #36). There is no <form> here — the
                 section lives inside the profile page's own markup and a nested
                 form would be invalid — so the key handler IS the submit
                 affordance. Without it the only way to save was to reach the
                 button, which on a phone means dismissing the keyboard first.
                 It routes through the SAME handler as the button, so the DR-C
                 gating and the in-flight guard apply identically. */
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              onBlur={() => {
                const v = emailInput.trim();
                if (v && v.length > EMAIL_MAX_LENGTH) setEmailError(TOO_LONG_EMAIL_ERROR);
                else if (v && !EMAIL_SHAPE.test(v)) setEmailError(MALFORMED_EMAIL_ERROR);
                /* Round 6 #21: the THIRD field verdict runs on blur like the two beside
                   it. The synthetic pre-check shipped on the Save path only, so a user
                   who typed a reserved address and tabbed on was told nothing until they
                   pressed Save — the one gate of the three that stayed silent, for no
                   reason other than that it was added later. Same predicate, same lane,
                   same order as the handler. */
                else if (v && isSyntheticAddress(v)) setEmailError(RESERVED_ADDRESS_ERROR);
              }}
            />
          </FormField>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 mt-2">
            <Button
              variant="primary"
              onClick={handleSave}
              aria-describedby={editActionError ? `${reactId}-edit-error` : undefined}
              aria-disabled={saveGated ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_SAVE}
            </Button>
            <Button
              variant="ghost"
              onClick={handleCancelEdit}
              aria-describedby={editActionError ? `${reactId}-edit-error` : undefined}
              aria-disabled={cancelGated ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_CANCEL}
            </Button>
          </div>
          {/* THE EDITING LANE'S VISIBLE HOME (round 5 #35/#39). Same shape as the
              awaiting-code block's action line and the revert error: beside the buttons,
              `role="alert"`, and pointed at by BOTH controls' `aria-describedby` so a
              user who returns to a gated Save or Cancel hears WHY rather than meeting a
              dimmed control with no reason (WCAG 4.1.2, and the consistency the three
              siblings already have). */}
          {editActionError && (
            <p id={`${reactId}-edit-error`} role="alert" className="text-content-status-error text-xs mt-2">
              {editActionError}
            </p>
          )}
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
          {/* LABELLED, not a bare paragraph (code review #40). The current address
              two blocks up has "The address we use now" over it; this one had
              nothing tying it to the "Not verified yet" state above or naming what
              it IS, so a screen-reader user met an unexplained address. */}
          <p className="text-xs text-content-muted">{PENDING_ADDRESS_LABEL}</p>
          <p className="text-base text-content-primary break-words mb-2">
            {pendingAddress ?? ''}
          </p>

          {/* PLAIN TEXT SINCE 2026-09-05 (code review #32). This was a
              `StatusRegion`, but it sits inside the `inAwaiting &&` block, so it
              mounted WITH its content and never announced the first send — the
              defect. The section now has exactly ONE live region, always mounted,
              up beside the current address; this is its visible twin. Deliberately
              NOT a second `StatusRegion`: two polite regions carrying the same
              sentence is a duplicate announcement, and it also made
              `getByRole('status')` ambiguous for six existing tests, which is the
              cheap signal that the markup was wrong. */}
          <p className="text-content-secondary text-sm mb-2">{sentLine ?? ''}</p>

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
              onChange={(e) => {
                setCodeInput(e.target.value);
                /* Round 3 #36: every failed verify EMPTIES this field and then sets
                   `codeError`, so the input sat `aria-invalid="true"` describing content
                   that no longer existed, and typing eight fresh characters never cleared
                   it (WCAG 3.3.1 pointing at nothing). First keystroke clears it. */
                if (codeError) setCodeError(null);
              }}
              /* ENTER SUBMITS — see the email field. A one-time-code input that
                 does not accept Enter is the worst offender of the two: the user
                 has just typed 8 characters and the natural next keystroke does
                 nothing. Same handler as the button, so the DR-C gate and the
                 in-flight guard apply identically. */
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleVerify();
                }
              }}
            />
          </FormField>

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 mt-2">
            <Button
              variant="primary"
              onClick={handleVerify}
              /* Round 6 #32: Verify points at the ACTION lane, like Resend and Discard
                 beside it. Its gate writes ACTION_BUSY_ERROR / SELF_UNAVAILABLE_ERROR
                 there, not into the code field — the code checks are the FormField's own
                 lane, which FormField already associates. Without this, a gated Verify
                 read as merely dimmed on re-focus with no reason given (WCAG 4.1.2). */
              aria-describedby={actionError ? `${reactId}-action-error` : undefined}
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
              aria-describedby={actionError ? `${reactId}-action-error` : undefined}
              aria-disabled={cooldown || mutating || selfRowMissing ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_RESEND}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDiscard}
              aria-describedby={actionError ? `${reactId}-action-error` : undefined}
              aria-disabled={mutating || selfRowMissing ? 'true' : undefined}
              className="max-md:min-h-11"
            >
              {LABEL_DISCARD}
            </Button>
          </div>
          {/* THE ACTION LANE'S VISIBLE HOME (code review #35). A Resend cooldown,
              a refused Resend or a failed Discard is a fact about the ACTION and
              belongs beside the buttons — not in the code field's error slot,
              where `FormField` would set `aria-invalid="true"` on an input the
              user has not mistyped and may not have touched. Mirrors the shape of
              the revert error below. */}
          {actionError && (
            <p id={`${reactId}-action-error`} role="alert" className="text-content-status-error text-xs mt-2">
              {actionError}
            </p>
          )}
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
