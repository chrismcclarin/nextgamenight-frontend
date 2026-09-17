'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { nextMonday, format, parseISO } from 'date-fns';
import AvailabilityGrid from './AvailabilityGrid';
// Relative (not `@/`) so this `.js` component resolves under vitest:
// vite-tsconfig-paths only maps `@/` for files in the TS project (tsconfig
// `include` is .ts/.tsx only), so `@/` aliases don't resolve from `.js`
// importers in tests. Matches the sibling ScheduleForm's import style.
import { availabilityFormAPI } from '../../lib/api';
import { useAppForm } from '../../lib/useAppForm';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { Button } from '../../components/ui/Button';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { logger, errCtx } from '@/lib/logger';

/**
 * Zod schema with cross-field validation
 * Either time_slots must have entries OR is_unavailable must be true
 */
const schema = z.object({
  time_slots: z.array(z.object({
    slotId: z.string(),
    preference: z.enum(['preferred', 'if-need-be']),
  })),
  is_unavailable: z.boolean(),
}).refine(
  (data) => data.is_unavailable || data.time_slots.length > 0,
  {
    message: 'Please select at least one time slot, or mark yourself as unavailable',
    path: ['time_slots']
  }
);

/**
 * AvailabilityForm - Form wrapper with RHF + Zod validation
 */
export default function AvailabilityForm({
  magicToken,
  userName,
  promptId,
  existingResponse = null,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  onSuccess,
  // Phase 81 Plan 02 (CHKIN-05) — gates the "Import from Google Calendar"
  // button. Plan 03 will use hasSavedAvailability for "Use my saved
  // availability" in the same button row.
  gcalConnected = false,
  hasSavedAvailability = false,
  // Rolling 7-day check-in window: the backend anchors this to the calendar
  // day the prompt email was sent (YYYY-MM-DD), so a Thursday send paints
  // Thu..Wed. Null (old backend deployments) falls back to nextMonday.
  windowStart = null,
}) {
  const [submitError, setSubmitError] = useState(null);

  /* DECISION Phase 88.6-25: the submit path carries a synchronous in-flight LATCH, and the
     submit CTA deliberately KEEPS its native `disabled` attribute. Both halves are choices.

     WHY THE LATCH EXISTS EVEN THOUGH THE BUTTON IS DISABLED: `disabled` stops a second CLICK on
     the button and nothing else. Pressing Enter inside any field still fires the form's submit,
     and `react-hook-form`'s `handleSubmit` does not refuse a concurrent run — so without this
     ref a fast double-Enter posts the availability twice. It is a ref and not state on purpose:
     `isSubmitting` is not readable synchronously at the top of the handler, which is where the
     refusal has to happen. Released in `finally`, so a thrown submit does not wedge the form.

     WHY `aria-disabled` WAS NOT TAKEN BY PLAN 25, and what changed. AMENDED Phase 88.6-42
     (owner-authorized 2026-09-16): the conversion IS TAKEN now, and the CTA below carries
     `aria-disabled` + this latch. Plan 25's reasoning was correct and is KEPT verbatim below
     because it is the record of WHY it waited: the blocker was a shipped gate's subject, not
     the design. Plan 42 cleared the blocker first — the spinner arcs are SVG `opacity`
     presentation attributes now, so test 53(b2)'s window contains no bare opacity utility —
     and only then converted. Reverting the CTA to native `disabled` is a decision, not a
     cleanup. The original record follows.

     Plans
     88.6-17 through -24 converged in-flight gates onto `aria-disabled` + a latch, because a
     natively-disabled button leaves the tab order the instant it disables and drops a keyboard
     user to <body> mid-submit. That reasoning applies to this control too, and it was
     IMPLEMENTED and then REVERTED on a measurement: `tokenContrast.test.ts`'s 88.8 HIGH-A gate
     (test 53(b2), owner-ruled) flags any bare `opacity-<n>` utility within 400 characters after
     an `aria-disabled=` attribute, and the submitting spinner's two SVG arcs below carry
     `opacity-25` / `opacity-75` — the ONLY bare opacity utilities left in `src/`. The gate's
     own comment calls that window a heuristic that should red loudly, so the choice was between
     re-spelling a shipped gate's subject and leaving the conversion for a plan that owns it.
     ROUTED, not dropped: `.planning/deferred/phase-88.6.md` carries the entry, with the
     spinner-arc collision named as the thing to solve first. Changing this is a decision. */
  const submitInFlightRef = useRef(false);

  // Phase 81 Plan 02 — shared pre-fill state (Plan 03 reuses both):
  //   prefillStatus: { source: 'gcal' | 'saved', count, failed? } | null
  //   isPrefilling: in-flight flag — disables both buttons during fetch
  const [prefillStatus, setPrefillStatus] = useState(null);
  const [isPrefilling, setIsPrefilling] = useState(false);

  // Compute the window start once and share with both the prefill API call AND
  // the grid (research Pitfall 5 — without sharing this anchor, a midnight /
  // DST transition can shift the prefill response relative to the painted
  // grid by one day). Anchored to the prompt's send day when the backend
  // provides it; parseISO yields LOCAL midnight (new Date('YYYY-MM-DD') would
  // parse as UTC and render the previous day in negative-offset timezones).
  const weekStartDate = useMemo(
    () => (windowStart ? parseISO(windowStart) : nextMonday(new Date())),
    [windowStart]
  );
  const weekStartIsoDate = useMemo(
    () => format(weekStartDate, 'yyyy-MM-dd'),
    [weekStartDate]
  );

  const isUpdate = existingResponse !== null && existingResponse.time_slots;
  const defaultTimeSlots = existingResponse?.time_slots || [];
  const defaultUnavailable = existingResponse?.is_unavailable || false;

  const {
    control,
    handleAppSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useAppForm(schema, {
    defaultValues: {
      time_slots: defaultTimeSlots,
      is_unavailable: defaultUnavailable,
    },
  });

  const isUnavailable = watch('is_unavailable');

  useEffect(() => {
    if (isUnavailable) {
      setValue('time_slots', []);
    }
  }, [isUnavailable, setValue]);

  const onSubmit = async (data) => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitError(null);

    try {
      const transformedSlots = data.time_slots.map(slot => {
        // BUG-01 / F-810: slot.slotId is now a correct UTC instant emitted by
        // AvailabilityGrid.generateSlotId (profile-TZ wall-clock -> UTC via
        // wallClockToUtc). The +30min end is pure instant arithmetic on that
        // corrected UTC instant — NO browser-local wall-clock re-derivation —
        // so start/end round-trip correctly when the profile TZ != browser TZ.
        // `user_timezone` (below) still threads the profile TZ to the payload.
        const startDate = new Date(slot.slotId);
        const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
        return {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          preference: slot.preference,
        };
      });

      const response = await availabilityFormAPI.submitResponse({
        magic_token: magicToken,
        time_slots: transformedSlots,
        user_timezone: timezone,
        is_unavailable: data.is_unavailable,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      onSuccess?.({
        slotCount: data.time_slots.length,
        isUnavailable: data.is_unavailable,
        response,
      });
    } catch (error) {
      // Set inline submit-error UI, then RE-THROW so handleAppSubmit's catch
      // logs it to logger.error -> Sentry (the reachable Sentry path, PRIM-06).
      //
      /* DECISION Phase 88.6-25 (R1 / D-31 / T-88-25-01): the ratified register answers this,
         with NO `fallback` passed — chosen OVER the hand-written
         'Failed to submit availability. Please try again.' literal that used to sit here, and
         over interpolating `error.message`. §6.2's W16 precedent is the model: passing no
         fallback yields the register's own generic line, so no copy is authored (P1).

         WHY THE GENERIC LINE IS WHAT LANDS, and it is a RECORDED RESIDUAL rather than an
         oversight: `submitResponse` has no `res.ok` check (`lib/api.ts:1086-1091`), so the
         value arriving here is the plain `Error` thrown two lines below `response.error` — no
         `ApiError`, no `code` — and `getFetchErrorMessage` therefore resolves `unknown`. Under
         the owner's D62 BRANCH-B ruling of 2026-09-09 the frontend does NOT learn a `code` for
         this path in Phase 88.6; `:130-132` and `lib/api.ts` stay byte-untouched (plan 88.6-42
         owns them, Phase 93 owns the backend `code`). CONSEQUENCE, stated so nobody reports it
         as a bug: on this anonymous magic-link page an EXPIRED link and a validation refusal
         render the SAME sentence until Phase 93 lands. Branch A — teaching this path a `code`
         in 88.6 — was considered and REJECTED on blast radius, not on the merits. */
      setSubmitError(getFetchErrorMessage(error));
      throw error;
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const handleUnavailableToggle = () => {
    setValue('is_unavailable', !isUnavailable);
  };

  // Phase 81 Plan 02 (CHKIN-05) — pre-fill the grid from Google Calendar.
  // Paints fetched slots as 'preferred' preference, surfaces an inline auto-fade
  // status message. The overwrite confirmation lives in `replaceGate` below.
  // Pitfall 6 mitigation: backend uses { consume: false } — token survives.
  const performGcalPrefill = useCallback(async () => {
    setIsPrefilling(true);
    try {
      const { slot_ids, count } = await availabilityFormAPI.prefillFromGcal({
        magicToken,
        startDate: weekStartIsoDate,
        numDays: 7,
        timezone,
      });
      // Pre-filled slots paint as 'preferred' (locked CONTEXT decision —
      // matches the "I'm available" semantic from GCal/saved sources).
      setValue(
        'time_slots',
        slot_ids.map((id) => ({ slotId: id, preference: 'preferred' }))
      );
      setPrefillStatus({ source: 'gcal', count });
      setTimeout(() => setPrefillStatus(null), 2500);
    } catch (err) {
      logger.info('[AvailabilityForm] GCal prefill failed:', errCtx(err));
      setPrefillStatus({ source: 'gcal', count: 0, failed: true });
      setTimeout(() => setPrefillStatus(null), 4000);
    } finally {
      setIsPrefilling(false);
    }
  }, [magicToken, weekStartIsoDate, timezone, setValue]);

  // Phase 81 Plan 03 (CHKIN-06) — pre-fill the grid from the user's saved
  // availability (recurring patterns + specific overrides, override-beats-
  // recurring). Mirrors the GCal fetch → paint → status flow behind the same
  // gate. Backend filters source:'default' so users with zero saved patterns
  // get an empty result here, NOT the whole grid (research Pitfall 3).
  const performSavedPrefill = useCallback(async () => {
    setIsPrefilling(true);
    try {
      const { slot_ids, count } = await availabilityFormAPI.prefillFromSaved({
        magicToken,
        startDate: weekStartIsoDate,
        numDays: 7,
        timezone,
      });
      setValue(
        'time_slots',
        slot_ids.map((id) => ({ slotId: id, preference: 'preferred' }))
      );
      setPrefillStatus({ source: 'saved', count });
      setTimeout(() => setPrefillStatus(null), 2500);
    } catch (err) {
      logger.info('[AvailabilityForm] Saved prefill failed:', errCtx(err));
      setPrefillStatus({ source: 'saved', count: 0, failed: true });
      setTimeout(() => setPrefillStatus(null), 4000);
    } finally {
      setIsPrefilling(false);
    }
  }, [magicToken, weekStartIsoDate, timezone, setValue]);

  // Phase 88-13 (Req 11, UI-SPEC §11.2): ONE dialog-tier gate serves both
  // pre-fill buttons. They guard the identical consequence — the painted grid is
  // overwritten — so they get identical copy from one config, and the committed
  // source is carried by useConfirmAction's targetId rather than by a second,
  // drift-prone config.
  //
  // Prior comment corrected rather than kept: this file used to record
  // `window.confirm` as "the existing idiom (FriendInvitePanel, GroupSettings,
  // ManageMembers)". That stopped being true this phase — every one of those
  // surfaces now routes through useConfirmAction, and these two sites were the
  // app's last native prompts. NOTE the one deliberate exception: FriendInvitePanel's
  // reset uses the toast-action confirmation shipped in 86-07, which is a
  // different idiom on purpose and is NOT part of this migration.
  //
  // The perform* callbacks report their own failures inline (prefillStatus.error)
  // and never reject, so the gate closes after a failed fetch. That is intended:
  // consent was given, and the failure surface is the status line under the
  // buttons — not a dialog left hanging open.
  const replaceGate = useConfirmAction({
    tier: 'dialog',
    title: 'Replace your current selections?',
    body: "What you've painted so far will be overwritten.",
    confirmLabel: 'Replace',
    onConfirm: (source) =>
      source === 'gcal' ? performGcalPrefill() : performSavedPrefill(),
  });

  // Pulled out of the object so the two callbacks below can depend on the STABLE
  // `trigger` identity. Depending on `replaceGate` itself (what exhaustive-deps
  // asks for) re-creates both handlers on every render — the hook returns a fresh
  // object each time — for no behavioural gain.
  const triggerReplace = replaceGate.trigger;

  const handleImportGcal = useCallback(() => {
    const currentSlots = watch('time_slots') || [];
    // Nothing painted yet means nothing to lose — no gate (unchanged behaviour).
    if (currentSlots.length > 0) {
      triggerReplace('gcal');
      return;
    }
    void performGcalPrefill();
  }, [watch, performGcalPrefill, triggerReplace]);

  const handleUseSaved = useCallback(() => {
    const currentSlots = watch('time_slots') || [];
    if (currentSlots.length > 0) {
      triggerReplace('saved');
      return;
    }
    void performSavedPrefill();
  }, [watch, performSavedPrefill, triggerReplace]);

  return (
    <>
    <form onSubmit={handleAppSubmit(onSubmit)} className="space-y-6">
      {/* Header Section */}
      <div className="border-b border-line pb-4">
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <span>Submitting as:</span>
          <span className="text-content-primary font-bold">{userName}</span>
        </div>
        {isUpdate && (
          <p className="mt-2 text-base text-content-link">
            You previously submitted availability for this week. Your response has been pre-filled below.
          </p>
        )}
      </div>

      {/* Pre-fill Button Row (Phase 81 — CHKIN-05 / CHKIN-06).
          - CHKIN-05 button: "Import from Google Calendar" — visible when gcalConnected.
          - CHKIN-06 button: "Use my saved availability" — always rendered; disabled
            with an explanatory hint when the user has no saved availability
            overlapping this week (a hidden button read as a bug — it should
            instead advertise that saving a schedule unlocks the shortcut). */}
      <div className="bg-surface-elevated border border-line rounded-card p-4 space-y-2">
        <p className="text-sm font-bold text-content-primary">Start with:</p>
        <div className="flex flex-col sm:flex-row gap-2">
          {gcalConnected && (
            <button
              type="button"
              onClick={handleImportGcal}
              disabled={isPrefilling || isUnavailable}
              className="flex-1 px-4 py-2 rounded-btn bg-surface-card border border-line text-content-secondary hover:border-line-strong active:opacity-75 transition-colors disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
            >
              {isPrefilling && prefillStatus?.source !== 'saved' ? 'Importing…' : 'Import from Google Calendar'}
            </button>
          )}
          <button
            type="button"
            onClick={handleUseSaved}
            disabled={!hasSavedAvailability || isPrefilling || isUnavailable}
            title={!hasSavedAvailability ? 'No saved availability for these dates' : undefined}
            className="flex-1 px-4 py-2 rounded-btn bg-surface-card border border-line text-content-secondary hover:border-line-strong active:opacity-75 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            {isPrefilling && prefillStatus?.source !== 'gcal' ? 'Loading…' : 'Use my saved availability'}
          </button>
        </div>
        {!hasSavedAvailability && (
          <p className="text-sm text-content-muted">
            No saved availability for these dates — add a weekly schedule in your profile settings to use this shortcut.
          </p>
        )}
        {/* DECISION Phase 88.6-25 (R1 / D-31 / T-88.6-66): the upstream string is GONE from this
            sentence, chosen OVER interpolating `prefillStatus.error` (which was `err.message`)
            after the colon. That message is RAW BACKEND TEXT — `lib/api.ts:1126` and `:1159` both
            do `const err = await res.json(); throw new Error(err.error || …)` — and this component
            renders on `app/availability-form/[token]/page.js`, the ANONYMOUS magic-link page, so
            the old form showed upstream text to a visitor with no session. Restoring "the detail"
            as a helpfulness improvement would reopen that disclosure. The `api.ts` side — throwing
            a real `ApiError` through `mapErrorToCode` so the register could name the actual
            outcome — is strictly better copy AND closes it at source, but `api.ts` is plan
            88.6-42's (wave 8) and Phase 93's; it is a NAMED follow-up, not a substitute.

            AND THE SECOND HALF, which is the one a tidy-up will take: `failed: true` is
            LOAD-BEARING. It is the only thing telling a FAILED prefill apart from a SUCCESSFUL one
            that found nothing, and the success path never sets it. `count: 0` CANNOT serve as the
            signal — the backend filters `source:'default'`, so a user with zero saved patterns
            legitimately resolves with zero (see the comment on `performSavedPrefill` above). A
            catch that wrote only `{ source, count: 0 }` would be byte-identical to an empty
            success and would tell an anonymous visitor "No saved availability matches this week"
            when the app does not know — the same empty-vs-failed defect registered as T-88.6-79 on
            `EventCalendar.js`. Deleting this flag, or re-keying the branch on the presence of a
            message, is a decision, not a cleanup. Both states are pinned for both arms in
            `AvailabilityForm.test.tsx`. */}
        {prefillStatus && (
          <p className="text-sm text-content-secondary transition-opacity">
            {prefillStatus.failed
              ? (prefillStatus.source === 'saved'
                  ? "Couldn't use saved availability."
                  : "Couldn't import from Google Calendar.")
              : prefillStatus.source === 'gcal'
                ? (prefillStatus.count > 0
                    ? `Filled ${prefillStatus.count} slots from Google Calendar.`
                    : 'No free slots found in Google Calendar for this week — paint manually below.')
                : (prefillStatus.count > 0
                    ? `Filled ${prefillStatus.count} slots from your saved availability.`
                    : 'No saved availability matches this week — paint manually below.')}
          </p>
        )}
      </div>

      {/* Unavailable Toggle Section */}
      <div className="bg-surface-elevated border border-line rounded-card p-4">
        <button
          type="button"
          onClick={handleUnavailableToggle}
          className={`
            w-full flex items-center justify-center gap-3 px-4 py-3 rounded-btn
            active:opacity-75 transition-colors duration-200
            focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2
            ${isUnavailable
              ? 'bg-status-error-subtle border-2 border-status-error text-content-status-error'
              : 'bg-surface-card border-2 border-line text-content-secondary hover:border-line-strong'
            }
          `}
        >
          <span className={`w-5 h-5 flex items-center justify-center rounded-sm border-2 ${
            isUnavailable ? 'bg-status-error border-status-error' : 'border-line-strong'
          }`}>
            {isUnavailable && (
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </span>
          <span>I&apos;m unavailable this week</span>
        </button>
        {isUnavailable && (
          <p className="mt-2 text-sm text-content-secondary text-center">
            The organizer will be notified that you cannot attend this week.
          </p>
        )}
      </div>

      {/* Grid Section */}
      <div className={`transition-opacity duration-200 ${isUnavailable ? 'opacity-50' : ''}`}>
        <Controller
          name="time_slots"
          control={control}
          render={({ field }) => (
            <AvailabilityGrid
              value={field.value}
              onChange={field.onChange}
              timezone={timezone}
              disabled={isUnavailable}
              weekStartDate={weekStartDate}
            />
          )}
        />
      </div>

      {/* Validation Error Display */}
      {errors.time_slots && (
        <div className="bg-status-error-subtle border border-status-error rounded-btn p-3">
          <p className="text-sm text-content-status-error">
            {errors.time_slots.message}
          </p>
        </div>
      )}

      {/* Submission Error Display (inline submit-error UI) */}
      {submitError && (
        <div className="bg-status-error-subtle border border-status-error rounded-btn p-3">
          <p role="alert" className="text-sm text-content-status-error">
            {submitError}
          </p>
        </div>
      )}

      {/* Submit Button */}
      <div className="pt-4 border-t border-line">
        {/* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the availability-grid surface's primary CTA (~37px today: the `py-3` here is DEAD — unlayered `.btn` padding beats layered utilities). Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor (rejected — would distort ~15 compact/icon `.btn` sites, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: `w-full`.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup.  ——— AMENDED Phase 88.6 (D-09), original reasoning above KEPT AS HISTORY: the desktop half is now ANSWERED, and again by a split. TAKEN: `min-h-11` on the `Button` primitive's cva base (`src/components/ui/Button.tsx`), which reaches every viewport width. STILL REJECTED: the ALL-VIEWPORT floor on the `.btn` CLASS — `globals.css`'s `@media (width < 48rem)` rule is unwidened (`globals.css:2677-2681`, reasoning at `:2647-2676`), because square-by-design controls wear `.btn` and a class-level floor would deform them. That is why both halves of this marker are still literally true: the rejection is about a rule on the CLASS; the new floor is on the PRIMITIVE, which only opted-in elements get. CONSEQUENCE: this per-CTA `min-h-11` becomes redundant ONLY once this element is a `<Button>`. Until this file's own migration sweep lands, deleting it still shrinks this control on desktop. When the sweep does land, dropping it is correct and is part of that commit — not a separate cleanup, and not something to do from here. */}
        {/* DECISION Phase 88.6-42 (D-8, owner-authorized 2026-09-16): this CTA now carries
            `aria-disabled` + the synchronous latch above, converging on the shape plans
            88.6-17 through -24 shipped — chosen OVER the native `disabled` attribute it
            carried through plan 25. A natively-disabled button leaves the tab order the
            INSTANT it disables, dropping a keyboard user to <body> mid-submit; `aria-disabled`
            keeps focus where the person put it and announces the state.

            THE BLOCKER PLAN 25 ROUTED IS CLEARED FIRST, and that ordering is the whole point:
            `tokenContrast.test.ts` test 53(b2) flags any bare `opacity-<n>` UTILITY within 400
            characters after an `aria-disabled=` attribute, and this button's spinner arcs were
            the only bare opacity utilities left in `src/`. They are now SVG `opacity`
            PRESENTATION ATTRIBUTES (see the svg below), which is the correct spelling for an
            SVG arc anyway — so the gate's subject is gone rather than its rule bent. Plan 25
            was right to keep native `disabled` rather than work around the gate; this plan is
            what owns the re-spell.

            The REFUSAL is the latch, not the attribute: `aria-disabled` is advisory, so a
            second click still enters `onSubmit`, where `submitInFlightRef` returns on the
            first line and releases in `finally`. Removing either half is a decision. */}
        <Button
          type="submit"
          aria-disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                {/* `opacity` as an SVG PRESENTATION ATTRIBUTE, not the Tailwind utility. Two
                    reasons and the second is the load-bearing one: it is the correct spelling
                    for an SVG arc, and it takes the last bare `opacity-<n>` utilities in
                    `src/` out of `tokenContrast` test 53(b2)'s 400-character window after the
                    `aria-disabled=` above. Re-introducing the utility spelling here would red
                    that gate and silently re-block the conversion. */}
                <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Submitting...
            </span>
          ) : (
            isUpdate ? 'Update Availability' : 'Submit Availability'
          )}
        </Button>
      </div>
    </form>
    {/* Deliberately a SIBLING of the <form>, not a child. A portalled dialog
        still bubbles its events through the React tree, so mounting it inside
        the form puts its controls one stray `type` attribute away from
        submitting the availability response. `statusNode` is mounted always and
        unconditionally (useConfirmAction's contract) — silent on the dialog
        tier, still there so a retier stays a one-word edit. */}
    <ConfirmDialog {...replaceGate.dialogProps} />
    {replaceGate.statusNode}
    </>
  );
}

// Named export for flexibility
export { AvailabilityForm };
