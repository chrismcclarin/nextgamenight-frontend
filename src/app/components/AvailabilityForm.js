'use client';

import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
 *
 * Wraps AvailabilityGrid with form state management, validation,
 * and API submission via magic token authentication.
 *
 * @param {Object} props
 * @param {string} props.magicToken - Magic token from URL for submission
 * @param {string} props.userName - User's name from token validation
 * @param {string} props.promptId - Prompt ID from token validation
 * @param {Object|null} props.existingResponse - Previous response for pre-fill (or null)
 * @param {string} props.timezone - Detected user timezone (IANA)
 * @param {function} props.onSuccess - Callback after successful submission
 */
export default function AvailabilityForm({
  magicToken,
  userName,
  promptId,
  existingResponse = null,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  onSuccess,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Determine if this is an update (has existing response)
  const isUpdate = existingResponse !== null && existingResponse.time_slots;

  // Parse existing response for default values
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

  // Watch is_unavailable to conditionally disable grid
  const isUnavailable = watch('is_unavailable');

  // Clear time_slots when marking as unavailable
  useEffect(() => {
    if (isUnavailable) {
      setValue('time_slots', []);
    }
  }, [isUnavailable, setValue]);

  // Handle form submission
  const onSubmit = async (data) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Transform time_slots from { slotId, preference } to { start, end, preference }
      // The slotId is an ISO8601 string representing the start time
      // End time is start + 30 minutes
      const transformedSlots = data.time_slots.map(slot => {
        const startDate = new Date(slot.slotId);
        const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // Add 30 minutes
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

      // Call success callback with response data
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

  // Toggle unavailable status
  const handleUnavailableToggle = () => {
    setValue('is_unavailable', !isUnavailable);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Header Section */}
      <div className="border-b border-gray-200 pb-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium">Submitting as:</span>
          <span className="text-gray-900 font-semibold">{userName}</span>
        </div>
        {isUpdate && (
          <p className="mt-2 text-sm text-blue-600">
            You previously submitted availability for this week. Your response has been pre-filled below.
          </p>
        )}
      </div>

      {/* Unavailable Toggle Section */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <button
          type="button"
          onClick={handleUnavailableToggle}
          className={`
            w-full flex items-center justify-center gap-3 px-4 py-3 rounded-md font-medium
            transition-colors duration-200
            ${isUnavailable
              ? 'bg-red-100 border-2 border-red-400 text-red-800'
              : 'bg-white border-2 border-gray-300 text-gray-700 hover:border-gray-400'
            }
          `}
        >
          <span className={`w-5 h-5 flex items-center justify-center rounded border-2 ${
            isUnavailable ? 'bg-red-500 border-red-500' : 'border-gray-400'
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
          <p className="mt-2 text-sm text-gray-600 text-center">
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
            />
          )}
        />
      </div>

      {/* Validation Error Display */}
      {errors.time_slots && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-700">
            {errors.time_slots.message}
          </p>
        </div>
      )}

      {/* Submission Error Display */}
      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-700">
            {submitError}
          </p>
        </div>
      )}

      {/* Submit Button */}
      <div className="pt-4 border-t border-gray-200">
        <button
          type="submit"
          disabled={isSubmitting}
          className={`
            w-full px-6 py-3 rounded-md font-medium text-white
            transition-colors duration-200
            ${isSubmitting
              ? 'bg-blue-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
            }
          `}
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
