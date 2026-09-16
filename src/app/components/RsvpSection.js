'use client';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { rsvpAPI } from '../../lib/api';
import ClickableMemberName from './ClickableMemberName';
// Phase 88.5 (SPEC Req 4 / D-07): the status copy/treatment map lifted out of this
// component body so the home hero card reads the SAME object. Its 87.7 D-18 marker
// travelled with it.
import { statusConfig } from './rsvpStatusConfig';
import { Textarea } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { formatDateTime } from '../../lib/datetime';
import { logger, errCtx } from '@/lib/logger';

/* The ratified note-save success string (UI-SPEC §6.3, owner ruling 2026-09-16, the same
   sitting that ratified the hero's "Response saved"). Declared ONCE here for the same
   reason `NextGameNightCard.tsx:94` declares its own: the clear-then-set rule below only
   works against a FIXED string, and a second spelling of it is the duplication this phase
   exists to remove. Authoring a different string here is copy authorship, not a cleanup. */
const NOTE_SAVED_MESSAGE = 'Note saved';

/**
 * RsvpSection - RSVP interface for a single event
 * Shows status buttons, note field, count banner, and grouped respondent list
 *
 * @param {object} self - The resolved self-identity row from useSelfIdentity
 *   ({ id: <Users.id UUID>, ... }). Own-RSVP resolution keys on `self.id` vs the
 *   nested `rsvp.User.id` UUID (Phase 87.3-04, D-04) — never the flat `user_id`
 *   (a sub through the PR-C window). Undefined while identity is still resolving.
 */
export default function RsvpSection({ eventId, self, eventDate, onRsvpChange }) {
  const [rsvps, setRsvps] = useState([]);
  const [summary, setSummary] = useState({ yes: 0, maybe: 0, no: 0 });
  const [userRsvp, setUserRsvp] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(null);
  const [savingNote, setSavingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noteSaved, setNoteSaved] = useState('');

  const isPastEvent = eventDate ? new Date(eventDate) < new Date() : false;

  /* DECISION Phase 88.6-29 (W43): the note field's ids come from `useId`, chosen OVER the
     fixed `id="rsvp-note"` the deferred register entry suggested. gameDetail renders one
     `RsvpSection` PER interactive upcoming-event card (`gameDetail/page.js:1533`), so a fixed
     id would mint duplicate ids on the multi-event arm and `htmlFor` would resolve to whichever
     control the browser saw first — silently mislabelling every card after the first. This is
     the same call `ParticipantRow.js:7-12`'s DECISION Phase 88-21 marker records for the same
     reason. Re-deriving these from a constant is a decision, not a cleanup. */
  const fieldId = useId();
  const noteId = `${fieldId}-note`;
  const noteCounterId = `${fieldId}-note-count`;

  /* The in-flight re-entry latches. `submitting` / `savingNote` are STATE, so two taps inside
     one React batch both read the pre-update value and both fire. The pressed control keeps
     `aria-disabled` rather than the native attribute (see the marker on the trio below), and an
     `aria-disabled` control refuses nothing by itself — the refusal is these refs, read
     SYNCHRONOUSLY on the handler's first line and released in `finally`. Both halves land or
     neither (`NextGameNightCard.tsx:468-479`; UI-SPEC D52 at `88.6-UI-SPEC.md:1008`). */
  const statusLatch = useRef(false);
  const saveNoteLatch = useRef(false);

  /* The group's accessible name, DERIVED from `eventDate` in the port's `RSVP for <when>` shape
     (`NextGameNightCard.tsx:453`). `formatDateTime` returns '' for a null/undefined/unparseable
     date (`src/lib/datetime.ts:287-296`), so the fallback below can never interpolate
     `undefined` or `Invalid Date` — the two shapes a naive template literal produces — and never
     reads the opaque `eventId` aloud.

     RECORDED REJECTED ALTERNATIVE: an explicit `label` prop passed from both call sites.
     Rejected on wave mechanics, not merit — `88.6-18-PLAN.md` is the same wave 7 and declares
     `gameDetail/page.js` as its first file, so the prop version puts two same-wave writers on
     one file for a label this derivation already delivers inside the one file this plan owns. */
  const whenLabel = formatDateTime(eventDate);
  const groupLabel = whenLabel ? `RSVP for ${whenLabel}` : 'RSVP for this event';

  // An unsaved, user-typed note draft. While true, NO fetch re-sync may repaint the
  // textarea — a status tap or identity resolution must never erase typed-but-unsaved
  // text (adversarial review 2026-09-01 round 2, HIGH: the status-only tap otherwise
  // REPLACES the draft with the server's old note). A ref, not state: fetchRsvps is a
  // useCallback([eventId, self?.id]) and a state read inside it would be a stale
  // closure (the remedy-skeptic's exact objection to the comparison variant).
  //
  // ADDENDUM Phase 88.6-29 (W60) — the sentences above are UNCHANGED and still correct; this is
  // appended, not a rewrite. The flag was cleared UNCONDITIONALLY in `handleSaveNote`, after the
  // submit await but BEFORE the follow-up `fetchRsvps`, so a keystroke typed during that round
  // trip lost its dirty flag and the two gated re-syncs below — which are correct, and are what
  // protects the status-tap path — repainted the server's value over it. It is now cleared only
  // when the draft is UNCHANGED since submit, compared against `noteDraft` below.
  // REJECTED, and for the reason this very marker already gives: capturing the value at request
  // time and comparing it to `note` on response. `fetchRsvps` is a `useCallback([eventId,
  // self?.id])`, so a state read inside a post-await comparison is a stale closure.
  // REJECTED (register option (a)): disabling the Textarea while `savingNote`. A natively
  // disabled control drops focus to `<body>` — the exact defect W44 fixes eight lines away in
  // this same plan, so shipping both would be the plan arguing with itself.
  // REJECTED: a debounce. It narrows the window without closing it, and the window is what the
  // test asserts.
  const noteDirty = useRef(false);
  // The live draft, as a REF. It is what the post-await comparison reads, precisely so that
  // comparison is never a closure read.
  const noteDraft = useRef('');

  /* THE PHASE'S ONE STALENESS IDIOM (W61), the same cancelled-generation guard shipped at
     `NextGameNightCard.tsx:231`/`:236`/`:241`/`:248-250` and adopted by plan 88.6-32's
     `ResponseDashboard.js:56`. It covers FOUR checkpoints: the success application, the catch,
     the finally, AND unmount.

     THE COUNTER IS COMPONENT-SCOPE, AND THE PORT IS DELIBERATELY NOT LITERAL — this is the part
     that is easy to get silently wrong. `NextGameNightCard`'s `let cancelled` lives INSIDE the
     effect that owns its promise, because that is the only place it calls from. Here
     `fetchRsvps` is a `useCallback` invoked from THREE places that know nothing about each
     other: the mount effect, `handleStatusClick`'s await and `handleSaveNote`'s. A literal
     effect-local copy would guard ONE of the three and leave the two handler fetches unguarded,
     silently, with nothing to show for it.

     RECORDED REJECTED ALTERNATIVE: a component-scope BOOLEAN that the effect cleanup sets true
     and nothing ever resets. It freezes the skeleton — `self?.id` resolving post-mount changes
     the callback identity and fires that cleanup, so the very next fetch would be discarded and
     `loading` would never clear. A monotonic counter has no such state.

     RECORDED REJECTED ALTERNATIVE: `AbortController`. It cancels the TRANSPORT, and what is
     wrong here is a LATE response writing over a newer one — the guard has to hold for a request
     that has already resolved. It is also inert under test (`rsvpAPI` is `vi.fn()`-mocked in
     every suite covering this component), would force signature widenings on `getEventRsvps`
     (`api.ts:721`) and, via plan 30, `getDeletionBlockers`, and `apiFetch` rethrows aborts raw
     and logs twice per abort. No shipped component uses it. */
  const generationRef = useRef(0);

  // The same skeptic's second objection, closed: gameDetail's single-event mount keys
  // this component by refresh counter, NOT event id, so ?event_id=A -> B re-renders
  // the SAME instance. A draft belongs to the event it was typed under — reset the
  // protection on event switch so event B's saved note can sync in.
  useEffect(() => {
    noteDirty.current = false;
    /* Phase 88.6-29: the SAME instance switching events must not carry the previous event's
       outcome. A stale CONFIRMATION is the more urgent of the two — it claims a save the user
       never made for the event now on screen, where a stale error only mis-attributes a
       failure (the reasoning `NextGameNightCard.tsx:220-225` records for the hero flip).
       Neither clear may be removed without removing the other's reason with it. */
    setError(null);
    setNoteSaved('');
  }, [eventId]);

  const fetchRsvps = useCallback(async () => {
    if (!eventId) return;
    // Captured PER ISSUE. Every checkpoint below compares this against the live counter, so a
    // superseded call is silent whether it resolves, rejects or merely finishes.
    const generation = generationRef.current;
    try {
      setError(null);
      const data = await rsvpAPI.getEventRsvps(eventId);
      if (generation !== generationRef.current) return;
      setRsvps(data.rsvps || []);
      setSummary(data.summary || { yes: 0, maybe: 0, no: 0 });

      // Phase 87.3-04: own-RSVP resolution keys on the nested User.id UUID vs
      // the resolved self UUID. Gated on identity resolution — while `self` is
      // unresolved, leave userRsvp untouched (loading/indeterminate), NEVER clear
      // it to "not mine". `self?.id` is in the dep array so this re-runs on resolve.
      if (self?.id) {
        const mine = (data.rsvps || []).find(r => r.User?.id === self.id);
        if (mine) {
          setUserRsvp(mine);
          setSelectedStatus(mine.status);
          // Both note re-syncs are gated on the draft flag (`noteDirty` above): the
          // saved note may hydrate an untouched box, never overwrite typed text.
          if (!noteDirty.current) {
            noteDraft.current = mine.note || '';
            setNote(noteDraft.current);
          }
        } else {
          setUserRsvp(null);
          setSelectedStatus(null);
          if (!noteDirty.current) {
            noteDraft.current = '';
            setNote('');
          }
        }
      }
    } catch (err) {
      /* THE GENERATION GUARD IS CHECKED FIRST, ahead of the log and `setError` — this plan's
         ruled ordering, and a deliberate divergence from plan 32's `ResponseDashboard.js:100-104`,
         which logs BEFORE its guard because AC-16 requires a Sentry EVENT on that path. This call
         is `logger.info`, a breadcrumb: a superseded read is not a diagnostic, and an unguarded
         one would spend a breadcrumb slot per supersession out of a buffer of 100. */
      if (generation !== generationRef.current) return;
      // AC-2 WIDENED (owner 2026-09-09), LEVEL AMENDED (owner 2026-09-13, D2): `logger.info` is
      // `Sentry.addBreadcrumb` (`logger.ts:34-36`) — a BREADCRUMB, not an event, so this creates
      // no new Sentry event and no new Session Replay egress. `logger.error`/`logger.warn` are
      // both captures and are the RECORDED REJECTED alternatives. `errCtx` (never a hand-written
      // `{ name, message }` literal) carries T-84-01's name-and-message-only payload: no RSVP
      // roster, no note body, no attendee identity.
      logger.info('Error fetching RSVPs:', errCtx(err));
      setError('Could not load RSVPs');
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [eventId, self?.id]);

  useEffect(() => {
    fetchRsvps();
    /* W61's FOURTH checkpoint — the cleanup this effect did not have. It bumps the generation on
       UNMOUNT and on any `fetchRsvps` identity change, so no in-flight response can write state
       after teardown or after the component has moved on. This component unmounts as a matter of
       routine: both gameDetail mounts are keyed by `rsvpRefreshKey`, which every event edit
       increments. React 18 dropped the unmounted-setState warning, so without this the writes are
       silent rather than visible. */
    return () => {
      generationRef.current += 1;
    };
  }, [fetchRsvps]);

  const handleStatusClick = async (status) => {
    if (isPastEvent) return;
    // SYNCHRONOUS re-entry refusal — the half that makes `aria-disabled` safe on the pressed
    // button. The `submitting` read below is kept as the state-level guard it already was.
    if (statusLatch.current || submitting) return;
    statusLatch.current = true;
    setSubmitting(status);
    // CLEAR-AT-START, BOTH REGIONS: a live region announces CHANGES, and success and error must
    // never stand together claiming contradictory outcomes of one surface.
    setError(null);
    setNoteSaved('');
    try {
      // DECISION Phase 88.5 (adversarial code review 2026-09-01, owner ruling a): a
      // status tap is STATUS-ONLY — no third `note` argument — chosen OVER the previous
      // `note || null` forwarding. Forwarding wiped a saved note whenever local `note`
      // state was stale-empty (identity unresolved when fetchRsvps landed, or a failed
      // fetch): `note || null` turned '' into an explicit clear. With the key absent,
      // POST /rsvp preserves the saved note (routes/rsvp.js, hoisted `noteUpdate`).
      // Accepted delta, taken knowingly: a status tap no longer saves an unsaved
      // textarea draft as a side effect — `handleSaveNote` below is the SOLE note
      // writer (still `note || null`, so clearing the textarea still clears the note).
      // The draft SURVIVES the tap in the box (`noteDirty` gates every re-sync);
      // "not saved" must never degrade to "erased" (round-2 HIGH, 2026-09-01).
      // Re-adding the third argument is a decision, not a cleanup.
      const result = await rsvpAPI.submitRsvp(eventId, status);
      setUserRsvp(result);
      setSelectedStatus(status);
      // Deliberately NO setNote from the response here: under the status-only tap the
      // echoed note is the server's OLD saved note, and painting it would erase a
      // typed-but-unsaved draft (round-2 HIGH). The gated fetchRsvps below re-syncs
      // an untouched box; a dirty draft survives.
      await fetchRsvps();
      if (onRsvpChange) onRsvpChange(status);
    } catch (err) {
      logger.info('Error submitting RSVP:', errCtx(err));
      setError('Could not save your response. Please try again.');
    } finally {
      statusLatch.current = false;
      setSubmitting(null);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedStatus) return;
    // Same synchronous latch as the status trio: this control is `aria-disabled` in flight, so
    // the refusal has to live here.
    if (saveNoteLatch.current || savingNote) return;
    saveNoteLatch.current = true;
    setSavingNote(true);
    setError(null);
    setNoteSaved('');
    // W60: the value that actually LEFT, captured before the await.
    const submitted = note;
    try {
      await rsvpAPI.submitRsvp(eventId, selectedStatus, submitted || null);
      /* W60, the whole fix: clear the draft flag ONLY when the box still holds what was sent.
         `noteDraft` is a REF, so this reads the LIVE value rather than a closure — a keystroke
         typed during the round trip leaves the flag standing and the re-sync below cannot
         repaint over it. */
      if (noteDraft.current === submitted) {
        noteDirty.current = false;
      }
      await fetchRsvps();
      setNoteSaved(NOTE_SAVED_MESSAGE);
    } catch (err) {
      logger.info('Error saving note:', errCtx(err));
      setError('Could not save your note. Please try again.');
    } finally {
      saveNoteLatch.current = false;
      setSavingNote(false);
    }
  };

  const grouped = {
    yes: rsvps.filter(r => r.status === 'yes'),
    maybe: rsvps.filter(r => r.status === 'maybe'),
    no: rsvps.filter(r => r.status === 'no'),
  };

  if (loading) {
    return (
      <div className="mt-4 p-4 bg-surface-elevated rounded-card">
        <p className="text-sm text-content-muted">Loading RSVPs...</p>
      </div>
    );
  }

  const totalResponses = summary.yes + summary.maybe + summary.no;

  return (
    <div className="mt-4 border border-line rounded-card overflow-hidden">
      {/* Header — Phase 65-03 EVT-06: relabel for past events so the
          read-only summary clearly reads as historical rather than
          looking like a broken/empty RSVP card. Card itself remains
          visible (count banner + grouped list below render
          unconditionally). */}
      <div className="bg-surface-elevated px-4 py-3 border-b border-line">
        <h3 className="font-semibold text-content-primary text-sm">
          {isPastEvent ? (
            <>
              Who came
              <span className="ml-2 text-xs font-normal text-content-muted">(closed)</span>
            </>
          ) : (
            'RSVP'
          )}
        </h3>
      </div>

      <div className="p-4 space-y-4">
        {/* User status label */}
        {!isPastEvent && (
          <div>
            {selectedStatus ? (
              <p className={`text-sm font-medium ${statusConfig[selectedStatus].textColor}`}>
                {statusConfig[selectedStatus].label}
              </p>
            ) : (
              <p className="text-sm text-content-muted">RSVP to this event</p>
            )}
          </div>
        )}

        {/* Button group */}
        {!isPastEvent && (
          /* W44, ported from the shipped sibling (`NextGameNightCard.tsx:446-455`): `role="group"`
             plus a label naming the EVENT is what distinguishes this trio from any other control
             pair on a page that renders several of them — gameDetail's multi-event arm mounts one
             `RsvpSection` per interactive card. */
          <div
            role="group"
            aria-label={groupLabel}
            className="flex rounded-card border border-line overflow-hidden"
          >
            {['yes', 'maybe', 'no'].map((status, idx) => {
              const isActive = selectedStatus === status;
              const isLoading = submitting === status;
              const otherInFlight = !!submitting && !isLoading;
              const config = statusConfig[status];
              return (
                /* DECISION Phase 88.6-29 (W44, D-07/D-08 · UI-SPEC A-5): the trio STAYS a bare
                   `<button>` — no `.btn`, no `<Button>` — and this is a CONSEQUENCE constraint,
                   not bookkeeping. `.btn` (`globals.css:1955-1967`) is unlayered and declares
                   `border-radius: 8px`, `font-weight: 600` and `font-size: 0.875rem`; plan 05
                   layers ONLY `border: none`. The radius would override
                   `first:rounded-l-[inherit] last:rounded-r-[inherit]` — which
                   `NextGameNightCard.tsx:483-487` records as an owner UAT finding of 2026-09-01
                   (without it the overflow clip shaves the selected 2px border off at the corner
                   arcs) — and the weight/size would silently defeat this same plan's type sweep.
                   The shipped port keeps the identical markup on a bare `<button>` under its own
                   `DECISION Phase 88.5 (SPEC Req 4)` marker. Migrating the trio is a decision that
                   overrides a shipped DECISION marker AND an owner UAT fix at once; it is not a
                   consistency cleanup, and it must not be "tidied" later either.

                   THE SPLIT DISABLED TREATMENT, ported from `NextGameNightCard.tsx:466-479`: the
                   PRESSED / in-flight button gets `aria-disabled` and NEVER the native attribute —
                   a natively-disabled element leaves the focus order, so in a real browser focus
                   drops to `<body>` mid-submit and a keyboard or switch user is stranded. The
                   re-tap it needs to refuse is refused in the HANDLER (`statusLatch`). Only the
                   OTHER two — which nobody is standing on — lose interactivity outright.

                   44px FLOOR: `min-h-11`, and it is not optional. It REPLACES the `py-2` half of
                   the shipped `px-3 py-2` pairing, which is exactly what
                   `NextGameNightCard.tsx:502-506`'s floor marker names as the thing not to
                   restore: `text-sm` (20px line) plus 16px of vertical padding computes to about
                   36px and fails the touch floor (D-07 constraint i). Disclosed as UI-SPEC §1.2
                   row V-19 and MEASURED by the phone-lane arm in `e2e/touch-targets.spec.ts` —
                   the class pin in `RsvpSection.statusOnly.test.tsx` catches a source revert,
                   the phone arm catches a rendered breach, and neither substitutes for the
                   other (jsdom performs no layout). */
                <button
                  key={status}
                  type="button"
                  aria-pressed={isActive}
                  aria-disabled={isLoading || undefined}
                  onClick={() => handleStatusClick(status)}
                  disabled={otherInFlight}
                  className={`flex-1 min-h-11 px-3 text-sm font-medium active:opacity-75 transition-colors first:rounded-l-[inherit] last:rounded-r-[inherit] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset
                    ${idx > 0 ? 'border-l border-line' : ''}
                    ${isActive
                      ? `${config.activeBg} ${config.activeBorder} border-2 text-content-primary`
                      : `bg-surface-card ${config.hoverBg} text-content-secondary`
                    }
                    ${otherInFlight ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {isLoading ? (
                    <>
                      <span
                        // The shipped spinner, swapped in PLACE so the button element — and
                        // therefore DOM focus — survives the submit.
                        className="inline-block animate-spin h-4 w-4 border-2 border-line-strong border-t-transparent rounded-full"
                        aria-hidden="true"
                      />
                      {/* The button deliberately KEEPS focus in flight (`aria-disabled` above), so
                          it must keep an accessible NAME too — otherwise the control the user just
                          activated announces as nothing for the whole round trip (WCAG 4.1.2;
                          `NextGameNightCard.tsx:526-530`). The busy context is ADDITIONAL to the
                          preserved status word, never a replacement for it: an `aria-label` on the
                          SPINNER is the natural wrong turn here and would leave the focused button
                          announcing as "loading" instead of "Going, saving". */}
                      <span className="sr-only">{config.buttonText}, saving</span>
                    </>
                  ) : (
                    config.buttonText
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Note field */}
        {!isPastEvent && selectedStatus && (
          <div className="space-y-2">
            {/* DECISION Phase 88.6-29 (W43): the label is REAL and associated by `htmlFor`, and it
                is VISUALLY HIDDEN rather than visible — chosen OVER a visible label, which is the
                option this plan's own action text prefers.

                WHY, and "there is no room" is NOT the reason: at 375px this card is full width and
                a 14px label line fits with room to spare, so the layout claim does not carry the
                decision. Two other things do. (a) A visible label would print the string the
                PLACEHOLDER already renders — "Add a note (optional)" — twice, about ten pixels
                apart; that is the exact shape plan 28's W45(a) arm B was rejected for on the
                sibling surface. (b) A new visible line on the phone-primary RSVP card is a §1.2
                sanctioned-delta needing a V-row and an owner ruling, and this plan allocates V-19
                for the 44px floor only. The a11y defect the register entry filed — a placeholder
                is not a persistent accessible name — is fully closed either way.

                If the owner prefers the visible label, it is one class change here plus a V-row;
                surfaced as an owner item in `88.6-29-SUMMARY.md`. */}
            <label htmlFor={noteId} className="sr-only">
              Add a note (optional)
            </label>
            <Textarea
              id={noteId}
              name={noteId}
              /* `maxLength` moves the 500-character discard from the `onChange` gate below to the
                 UA and exposes the limit programmatically. STATED HONESTLY: it does NOT announce
                 anything at the moment the cap is reached — the 501st keystroke is still silently
                 dropped as far as a screen-reader user's ear is concerned. That residual is
                 ROUTED on the W43 register entry, not claimed closed. The JS gate stays as the
                 backstop for programmatic value writes, which `maxLength` does not cover. */
              maxLength={500}
              aria-describedby={noteCounterId}
              value={note}
              onChange={(e) => {
                if (e.target.value.length <= 500) {
                  // User-typed text = an unsaved draft; block fetch re-syncs from
                  // repainting the box until Save note lands (see `noteDirty`).
                  noteDirty.current = true;
                  // W60: the ref tracks the draft in lockstep with the state, and it is what
                  // `handleSaveNote`'s post-await comparison reads.
                  noteDraft.current = e.target.value;
                  setNote(e.target.value);
                }
              }}
              placeholder="Add a note (optional)"
              rows={2}
              className="resize-none"
            />
            <div className="flex items-center justify-between">
              <span id={noteCounterId} className="text-xs text-content-muted">
                {note.length}/500
              </span>
              {/* DECISION Phase 88.6-29 (W44, extended to the SECOND gated control on this
                  surface): the Save-note button takes the SAME split as the status trio —
                  `aria-disabled` plus the synchronous `saveNoteLatch`, NEVER the native
                  `disabled` it carried. Fixing three buttons on one surface and leaving the
                  fourth would ship a third reading of ONE rule in one component. The split is
                  already ratified twice: `NextGameNightCard.tsx:466-479`'s
                  `DECISION Phase 88.5` marker for the trio, and D52 for the deletion modal's
                  Cancel (`88.6-UI-SPEC.md:1008` — `aria-disabled` plus a first-line handler
                  guard, "**not** the native `disabled` attribute … the recorded rejected
                  alternative").

                  THE BUSY STRING ADDS TO THE NAME, it does not replace it. The visible label
                  stays "Save note" at every moment and the in-flight name resolves to
                  "Save note, saving"; the shipped "Saving..." text swap is REJECTED because it
                  replaces the control's whole accessible name with a bare progress word. The
                  visible in-flight cue is not lost with it — the spinner beside the label is the
                  same cue the three buttons above already use, so this surface ships ONE reading
                  of the in-flight idiom rather than two.

                  `text-sm px-3 py-1` are DELETED, not carried: every size utility is DEAD on a
                  `.btn` element (`Button.tsx`'s own "No size utility of any kind" rule), so they
                  were never rendering anything. */}
              <Button
                variant="primary"
                aria-disabled={savingNote || undefined}
                onClick={handleSaveNote}
              >
                Save note
                {savingNote && (
                  <>
                    <span
                      className="ml-2 inline-block animate-spin h-4 w-4 border-2 border-line-strong border-t-transparent rounded-full align-middle"
                      aria-hidden="true"
                    />
                    <span className="sr-only">, saving</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/*
          THE OUTCOME PAIR (W44/P3 + the note-save success). Both regions are ALWAYS MOUNTED and
          EMPTY-FIRST — `StatusRegion`'s documented contract (`StatusRegion.tsx:9-12`): a screen
          reader announces CHANGES to a live region, not the conditional mount of a new one, so
          the `{error && …}` this replaces made the failure silent for exactly the users who need
          it most. Do NOT add `empty:hidden` either — `display:none` takes the region out of the
          accessibility tree, which is the same defect wearing a different hat.

          THE WRAPPER IS `display: contents`, and that is a requirement rather than tidiness. The
          parent stack is `space-y-4` (`> * + *`), so an always-mounted normal child would take a
          permanent 16px top margin while it is empty and zero-height — an idle layout delta on
          this card that nothing sanctions. A `contents` box generates no box, so the parent's
          margin never applies, and each region carries its own `mt-4` only when it has something
          to say. That reproduces the OLD conditional `<p>`'s spacing exactly: 16px when set,
          nothing when empty. Hoisting either region out of this wrapper re-opens the delta.

          DECISION Phase 88.6-29 (W44, the SUCCESS half): the note-save success announces through
          a SIBLING always-mounted POLITE region carrying the ratified string "Note saved"
          (UI-SPEC §6.3, owner ruling 2026-09-16 — this plan WIRES it and does not re-ratify it).
          Visible when set, per the 2026-09-14 ruling (#32 + #166, arm 2) that made this phase's
          new polite regions visible rather than `sr-only`; `sr-only` is the RECORDED REJECTED
          arm. It is NOT a mirror of the assertive region beside it: that one is `role="alert"` in
          error ink, and routing a confirmation through it would fire a success at the user as an
          interruption, painted red. Two regions here is not a §6.2 breach — the failure still has
          exactly ONE region, and a success region is not a failure region (the distinction D52
          records for the deletion modal's progress region).

          INK: `text-content-secondary`, the same choice plan 28 made and for the same reason — a
          success GREEN would be a new colour on this surface with no V-row behind it. SIZE: none
          authored; `StatusRegion` is `cn('text-sm', className)`.

          THE CLEAR-AT-START IN BOTH HANDLERS IS PART OF THIS, not an incidental detail: the
          string is FIXED, and a fixed string re-set into an unchanged region is a React bail-out
          — no DOM mutation, no announcement — so without it only the FIRST save ever announces.
          That same clear IS the mutual clear; there is deliberately no second one in the `catch`.
        */}
        <div className="contents">
          <StatusRegion
            politeness="assertive"
            className={`text-content-status-error ${error ? 'mt-4' : ''}`}
            message={error}
          />
          <StatusRegion
            politeness="polite"
            className={`text-content-secondary ${noteSaved ? 'mt-4' : ''}`}
            message={noteSaved}
          />
        </div>

        {/* Count banner */}
        {totalResponses > 0 && (
          <div className="flex items-center gap-3 text-sm">
            {summary.yes > 0 && (
              <span className="text-content-status-success font-medium">{summary.yes} Yes</span>
            )}
            {summary.yes > 0 && (summary.maybe > 0 || summary.no > 0) && (
              <span className="text-line-strong">|</span>
            )}
            {summary.maybe > 0 && (
              <span className="text-content-status-warning font-medium">{summary.maybe} Maybe</span>
            )}
            {summary.maybe > 0 && summary.no > 0 && (
              <span className="text-line-strong">|</span>
            )}
            {summary.no > 0 && (
              <span className="text-content-muted font-medium">{summary.no} No</span>
            )}
          </div>
        )}

        {/* Grouped RSVP list */}
        {totalResponses > 0 ? (
          <div className="space-y-3">
            {['yes', 'maybe', 'no'].map((status) => {
              const group = grouped[status];
              const config = statusConfig[status];
              if (group.length === 0) return null;
              return (
                <div key={status}>
                  <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${config.textColor}`}>
                    {config.sectionTitle} ({group.length})
                  </p>
                  <div className="space-y-1">
                    {group.map((rsvp) => (
                      <div key={rsvp.id} className="flex flex-col">
                        <span className="text-sm text-content-primary">
                          {/* Phase 87.3-04: guard + key the friend-request
                              affordance on the nested User.id UUID, not the
                              sub-shaped nested-sub field — so PR-C dropping that
                              field from the include cannot silently remove the
                              affordance, and the userId handed to the (soon
                              UUID-keyed) friendship provider is a UUID. */}
                          {rsvp.User?.id ? (
                            <ClickableMemberName userId={rsvp.User.id} username={rsvp.User.username || 'Unknown'} />
                          ) : (
                            'Unknown'
                          )}
                        </span>
                        {rsvp.note && (
                          <span className="text-xs text-content-muted ml-0 mt-0.5">{rsvp.note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-content-muted">
            {isPastEvent ? "No one RSVP'd to this session." : 'No responses yet'}
          </p>
        )}
      </div>
    </div>
  );
}
