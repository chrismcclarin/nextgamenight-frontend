'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AvailabilityGrid from './AvailabilityGrid';
import { pollsAPI } from '../../lib/api';

/**
 * PollResponseForm — POLL-01 authenticated availability submission.
 *
 * Pre-resolved decision (Plan 71-05 Warning #11): AvailabilityForm.js is too
 * tightly coupled to the magic-token recurring-schedule submission flow to
 * reuse directly — its props are { magicToken, promptId, ... } and the submit
 * handler hardcodes availabilityFormAPI.submitResponse({ magic_token, ... }).
 *
 * This component reuses the inner `AvailabilityGrid` presentational component
 * (already decoupled from submission) and wires submit to
 * `pollsAPI.submitResponse(pollId, slotData)`. AvailabilityForm.js is left
 * untouched for the magic-token recurring-schedule flow.
 *
 * Critical date-window mapping:
 *   - Poll has date_window_start + date_window_end (YYYY-MM-DD strings).
 *   - AvailabilityGrid takes weekStartDate (Date) + numDays (count).
 *   - We compute numDays = (end - start) + 1 day and pass weekStartDate as a
 *     Date built from date_window_start at local midnight (NOT UTC parse,
 *     which would shift to the previous day for users west of UTC).
 *
 * slot_data contract (matches backend tally in pollService.notifyPollClosed):
 *   [{ date: 'YYYY-MM-DD', slot: ISO, end: ISO, available: true, preference }]
 *   Empty array signals is_unavailable.
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
    message: 'Pick at least one time slot, or mark yourself as unavailable',
    path: ['time_slots'],
  }
);

function existingResponseToTimeSlots(existingResponse) {
  // PollResponse.slot_data is an array of { date, slot, end, available, preference }.
  // AvailabilityGrid expects [{ slotId, preference }] where slotId is the ISO
  // datetime of the slot start. The submit handler reverse-maps to slot_data.
  if (!existingResponse?.slot_data || !Array.isArray(existingResponse.slot_data)) {
    return [];
  }
  return existingResponse.slot_data
    .filter((s) => s && s.available && s.slot)
    .map((s) => ({
      slotId: s.slot,
      preference: s.preference || 'preferred',
    }));
}

export default function PollResponseForm({
  pollId,
  dateWindowStart,
  dateWindowEnd,
  existingResponse = null,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  onSuccess,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Build the weekStart Date from date_window_start. Use local-midnight parse
  // (NOT new Date('YYYY-MM-DD'), which is interpreted as UTC midnight and
  // shifts users west of UTC to the previous calendar day).
  const weekStartDate = useMemo(() => {
    if (!dateWindowStart) return null;
    return new Date(`${dateWindowStart}T00:00:00`);
  }, [dateWindowStart]);

  // Compute the number of days in the poll's date window.
  const numDays = useMemo(() => {
    if (!dateWindowStart || !dateWindowEnd) return 7;
    const start = new Date(`${dateWindowStart}T00:00:00`);
    const end = new Date(`${dateWindowEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 7;
    const ms = end.getTime() - start.getTime();
    return Math.max(1, Math.min(14, Math.round(ms / (24 * 60 * 60 * 1000)) + 1));
  }, [dateWindowStart, dateWindowEnd]);

  const isUpdate = existingResponse != null;
  const defaultTimeSlots = useMemo(
    () => existingResponseToTimeSlots(existingResponse),
    [existingResponse]
  );
  const defaultUnavailable = !!(existingResponse && Array.isArray(existingResponse.slot_data) && existingResponse.slot_data.length === 0);

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

  const handleUnavailableToggle = () => {
    setValue('is_unavailable', !isUnavailable);
  };

  const onSubmit = async (data) => {
    setSubmitting(true);
    setError(null);
    try {
      // Reverse-map AvailabilityGrid's [{ slotId, preference }] back to the
      // backend's slot_data shape. The grid's slotId is the ISO datetime
      // start; date is derived from it. End = start + 30min (matches the
      // grid's fixed 30-min slot granularity).
      const slotData = data.is_unavailable
        ? []
        : data.time_slots.map((slot) => {
            const start = new Date(slot.slotId);
            const end = new Date(start.getTime() + 30 * 60 * 1000);
            // Use local-date string for the `date` field (matches what the
            // creator picked in the date-window picker — a calendar date,
            // not a UTC instant).
            const yyyy = start.getFullYear();
            const mm = String(start.getMonth() + 1).padStart(2, '0');
            const dd = String(start.getDate()).padStart(2, '0');
            return {
              date: `${yyyy}-${mm}-${dd}`,
              slot: start.toISOString(),
              end: end.toISOString(),
              available: true,
              preference: slot.preference,
            };
          });
      const response = await pollsAPI.submitResponse(pollId, slotData);
      onSuccess?.(response);
    } catch (err) {
      setError(err?.message || 'Failed to submit response. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!weekStartDate) {
    return (
      <p className="text-sm text-content-muted">
        Poll date window is missing — cannot render response form.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Unavailable toggle — same UX as AvailabilityForm.js, scoped to the
          poll window instead of "this week". */}
      <div className="bg-surface-elevated border border-line rounded-card p-3">
        <button
          type="button"
          onClick={handleUnavailableToggle}
          className={`w-full flex items-center justify-center gap-3 px-4 py-2 rounded-btn font-medium transition-colors duration-200 ${
            isUnavailable
              ? 'bg-status-error/10 border-2 border-status-error text-status-error'
              : 'bg-surface-card border-2 border-line text-content-secondary hover:border-line-strong'
          }`}
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
          <span>I&apos;m unavailable for this whole window</span>
        </button>
      </div>

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
              numDays={numDays}
            />
          )}
        />
      </div>

      {errors.time_slots && (
        <div className="bg-status-error/10 border border-status-error/30 rounded-btn p-3">
          <p className="text-sm text-status-error">{errors.time_slots.message}</p>
        </div>
      )}

      {error && (
        <div className="bg-status-error/10 border border-status-error/30 rounded-btn p-3">
          <p className="text-sm text-status-error">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={`btn btn-primary w-full py-2 ${submitting ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {submitting ? 'Submitting...' : isUpdate ? 'Update response' : 'Submit response'}
      </button>
    </form>
  );
}
