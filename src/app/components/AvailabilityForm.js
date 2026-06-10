'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { nextMonday, format } from 'date-fns';
import AvailabilityGrid from './AvailabilityGrid';
import { availabilityFormAPI } from '@/lib/api';

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
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Phase 81 Plan 02 — shared pre-fill state (Plan 03 reuses both):
  //   prefillStatus: { source: 'gcal' | 'saved', count, error? } | null
  //   isPrefilling: in-flight flag — disables both buttons during fetch
  const [prefillStatus, setPrefillStatus] = useState(null);
  const [isPrefilling, setIsPrefilling] = useState(false);

  // Compute the week start once and share with both the prefill API call AND
  // the grid (research Pitfall 5 — without sharing this anchor, a midnight /
  // DST transition can shift the prefill response relative to the painted
  // grid by one day).
  const weekStartDate = useMemo(() => nextMonday(new Date()), []);
  const weekStartIsoDate = useMemo(
    () => format(weekStartDate, 'yyyy-MM-dd'),
    [weekStartDate]
  );

  const isUpdate = existingResponse !== null && existingResponse.time_slots;
  const defaultTimeSlots = existingResponse?.time_slots || [];
  const defaultUnavailable = existingResponse?.is_unavailable || false;

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
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
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const transformedSlots = data.time_slots.map(slot => {
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
      console.error('Submission error:', error);
      setSubmitError(error.message || 'Failed to submit availability. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnavailableToggle = () => {
    setValue('is_unavailable', !isUnavailable);
  };

  // Phase 81 Plan 02 (CHKIN-05) — pre-fill the grid from Google Calendar.
  // Confirms before overwriting existing painted slots, paints fetched slots
  // as 'preferred' preference, surfaces an inline auto-fade status message.
  // Pitfall 6 mitigation: backend uses { consume: false } — token survives.
  const handleImportGcal = useCallback(async () => {
    const currentSlots = watch('time_slots') || [];
    if (currentSlots.length > 0) {
      // window.confirm is the existing idiom (FriendInvitePanel, GroupSettings, ManageMembers)
      if (!window.confirm('This will replace your current selections. Continue?')) return;
    }

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
      console.error('[AvailabilityForm] GCal prefill failed:', err);
      setPrefillStatus({ source: 'gcal', count: 0, error: err.message });
      setTimeout(() => setPrefillStatus(null), 4000);
    } finally {
      setIsPrefilling(false);
    }
  }, [magicToken, weekStartIsoDate, timezone, watch, setValue]);

  // Phase 81 Plan 03 (CHKIN-06) — pre-fill the grid from the user's saved
  // availability (recurring patterns + specific overrides, override-beats-
  // recurring). Mirrors handleImportGcal's confirm → fetch → paint → status
  // flow. Backend filters source:'default' so users with zero saved patterns
  // get an empty result here, NOT the whole grid (research Pitfall 3).
  const handleUseSaved = useCallback(async () => {
    const currentSlots = watch('time_slots') || [];
    if (currentSlots.length > 0) {
      if (!window.confirm('This will replace your current selections. Continue?')) return;
    }

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
      console.error('[AvailabilityForm] Saved prefill failed:', err);
      setPrefillStatus({ source: 'saved', count: 0, error: err.message });
      setTimeout(() => setPrefillStatus(null), 4000);
    } finally {
      setIsPrefilling(false);
    }
  }, [magicToken, weekStartIsoDate, timezone, watch, setValue]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Header Section */}
      <div className="border-b border-line pb-4">
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <span className="font-medium">Submitting as:</span>
          <span className="text-content-primary font-semibold">{userName}</span>
        </div>
        {isUpdate && (
          <p className="mt-2 text-sm text-content-link">
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
        <p className="text-sm font-medium text-content-primary">Start with:</p>
        <div className="flex flex-col sm:flex-row gap-2">
          {gcalConnected && (
            <button
              type="button"
              onClick={handleImportGcal}
              disabled={isPrefilling || isUnavailable}
              className="flex-1 px-4 py-2 rounded-btn bg-surface-card border border-line text-content-secondary hover:border-line-strong font-medium transition-colors disabled:opacity-50"
            >
              {isPrefilling && prefillStatus?.source !== 'saved' ? 'Importing…' : 'Import from Google Calendar'}
            </button>
          )}
          <button
            type="button"
            onClick={handleUseSaved}
            disabled={!hasSavedAvailability || isPrefilling || isUnavailable}
            title={!hasSavedAvailability ? 'No saved availability for this week' : undefined}
            className="flex-1 px-4 py-2 rounded-btn bg-surface-card border border-line text-content-secondary hover:border-line-strong font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line"
          >
            {isPrefilling && prefillStatus?.source !== 'gcal' ? 'Loading…' : 'Use my saved availability'}
          </button>
        </div>
        {!hasSavedAvailability && (
          <p className="text-sm text-content-muted">
            No saved availability for this week — add a weekly schedule in your profile settings to use this shortcut.
          </p>
        )}
        {prefillStatus && (
          <p className="text-sm text-content-secondary transition-opacity">
            {prefillStatus.error
              ? (prefillStatus.source === 'saved'
                  ? `Couldn't use saved availability: ${prefillStatus.error}`
                  : `Couldn't import from Google Calendar: ${prefillStatus.error}`)
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
            w-full flex items-center justify-center gap-3 px-4 py-3 rounded-btn font-medium
            transition-colors duration-200
            ${isUnavailable
              ? 'bg-status-error/10 border-2 border-status-error text-status-error'
              : 'bg-surface-card border-2 border-line text-content-secondary hover:border-line-strong'
            }
          `}
        >
          <span className={`w-5 h-5 flex items-center justify-center rounded border-2 ${
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
        <div className="bg-status-error/10 border border-status-error/30 rounded-btn p-3">
          <p className="text-sm text-status-error">
            {errors.time_slots.message}
          </p>
        </div>
      )}

      {/* Submission Error Display */}
      {submitError && (
        <div className="bg-status-error/10 border border-status-error/30 rounded-btn p-3">
          <p className="text-sm text-status-error">
            {submitError}
          </p>
        </div>
      )}

      {/* Submit Button */}
      <div className="pt-4 border-t border-line">
        <button
          type="submit"
          disabled={isSubmitting}
          className={`btn btn-primary w-full py-3 ${isSubmitting ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Submitting...
            </span>
          ) : (
            isUpdate ? 'Update Availability' : 'Submit Availability'
          )}
        </button>
      </div>
    </form>
  );
}

// Named export for flexibility
export { AvailabilityForm };
