'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import AvailabilityForm from '@/app/components/AvailabilityForm';
import { magicAuthAPI, availabilityFormAPI } from '@/lib/api';

/**
 * Page states for the availability form flow
 */
const PAGE_STATES = {
  LOADING: 'loading',
  ERROR: 'error',
  READY: 'ready',
  SUBMITTED: 'submitted',
};

/**
 * AvailabilityFormPage - Public page for magic token-based availability submission
 *
 * Flow:
 * 1. Validates magic token on mount
 * 2. Shows form if valid, error state if invalid
 * 3. Shows confirmation after successful submission
 *
 * This page does NOT require Auth0 authentication - it uses magic tokens
 */
export default function AvailabilityFormPage() {
  const { token } = useParams();

  // Page state
  const [pageState, setPageState] = useState(PAGE_STATES.LOADING);
  const [errorMessage, setErrorMessage] = useState(null);

  // Token validation data
  const [tokenData, setTokenData] = useState(null);
  const [existingResponse, setExistingResponse] = useState(null);

  // Submission result
  const [submissionResult, setSubmissionResult] = useState(null);

  // Timezone detection (client-side only)
  const [timezone, setTimezone] = useState('UTC');

  // Detect timezone on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, []);

  // Validate token and fetch existing response on mount
  useEffect(() => {
    const validateAndFetch = async () => {
      if (!token) {
        setErrorMessage('No token provided');
        setPageState(PAGE_STATES.ERROR);
        return;
      }

      try {
        // Store when the form was loaded for token validation
        const formLoadedAt = new Date().toISOString();

        // Validate the magic token
        const validation = await magicAuthAPI.validateToken(token, formLoadedAt);

        if (!validation || validation.error || !validation.valid) {
          setErrorMessage('This link is no longer valid. It may have expired or already been used.');
          setPageState(PAGE_STATES.ERROR);
          return;
        }

        // Token is valid - store the data
        setTokenData({
          userName: validation.user?.name || 'User',
          promptId: validation.prompt_id,
          expiresAt: validation.expiresAt,
          gameName: validation.game?.name || null,
        });

        // Try to fetch existing response for pre-fill
        try {
          const existing = await availabilityFormAPI.getExistingResponse(
            validation.prompt_id,
            token
          );
          if (existing && !existing.error) {
            setExistingResponse(existing);
          }
        } catch (prefillError) {
          // Pre-fill is optional - ignore errors
          console.log('No existing response to pre-fill');
        }

        setPageState(PAGE_STATES.READY);
      } catch (error) {
        console.error('Token validation error:', error);
        setErrorMessage('This link is no longer valid. Please request a new one from your group organizer.');
        setPageState(PAGE_STATES.ERROR);
      }
    };

    validateAndFetch();
  }, [token]);

  // Handle successful form submission
  const handleSubmissionSuccess = useCallback((result) => {
    setSubmissionResult(result);
    setPageState(PAGE_STATES.SUBMITTED);
  }, []);

  // Handle request new link
  const handleRequestNewLink = useCallback(async () => {
    // This would call magicAuthAPI.requestNew but that's not implemented yet
    // For now, show instruction to contact organizer
    setErrorMessage(
      'Please contact your group organizer to request a new availability link.'
    );
  }, []);

  // Calculate time remaining until token expires
  const getTimeRemaining = useCallback(() => {
    if (!tokenData?.expiresAt) return null;
    const now = new Date();
    const expiry = new Date(tokenData.expiresAt);
    const remaining = expiry - now;

    if (remaining <= 0) return null;

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 1) return `${hours} hours`;
    if (hours === 1) return `1 hour ${minutes} minutes`;
    return `${minutes} minutes`;
  }, [tokenData?.expiresAt]);

  // Check if token expires within 1 hour
  const isExpiryWarning = useCallback(() => {
    if (!tokenData?.expiresAt) return false;
    const now = new Date();
    const expiry = new Date(tokenData.expiresAt);
    const remaining = expiry - now;
    return remaining > 0 && remaining < 60 * 60 * 1000; // Less than 1 hour
  }, [tokenData?.expiresAt]);

  // Render loading state
  if (pageState === PAGE_STATES.LOADING) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Validating your link...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (pageState === PAGE_STATES.ERROR) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Link No Longer Valid
          </h1>
          <p className="text-gray-600 mb-6">
            {errorMessage}
          </p>
          <button
            onClick={handleRequestNewLink}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Request New Link
          </button>
          <p className="mt-4 text-sm text-gray-500">
            Or contact your group organizer for assistance.
          </p>
        </div>
      </div>
    );
  }

  // Render submitted/confirmation state
  if (pageState === PAGE_STATES.SUBMITTED) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Availability Submitted!
          </h1>
          <p className="text-gray-600 mb-4">
            {submissionResult?.isUnavailable ? (
              'You have been marked as unavailable for this week.'
            ) : (
              `You selected ${submissionResult?.slotCount || 0} time slot${submissionResult?.slotCount !== 1 ? 's' : ''}.`
            )}
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Your group organizer will be notified of your response.
          </p>
          <div className="border-t border-gray-200 pt-4">
            <p className="text-sm text-gray-600 mb-2">
              You can safely close this tab.
            </p>
            <p className="text-xs text-gray-400">
              Made a mistake? You can reopen this link to update your response until the deadline.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render ready state (form)
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Submit Your Availability
          </h1>
          <p className="text-gray-600">
            Select the times you&apos;re available for this week&apos;s {tokenData?.gameName || 'Game TBD'} session.
          </p>

          {/* Token expiry warning */}
          {isExpiryWarning() && (
            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-sm text-yellow-800">
                <span className="font-medium">Heads up:</span> This link expires in {getTimeRemaining()}. Please submit your availability soon.
              </p>
            </div>
          )}
        </div>

        {/* Form Container */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <AvailabilityForm
            magicToken={token}
            userName={tokenData?.userName}
            promptId={tokenData?.promptId}
            existingResponse={existingResponse}
            timezone={timezone}
            onSuccess={handleSubmissionSuccess}
          />
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>
            Times shown in your local timezone ({timezone})
          </p>
        </div>
      </div>
    </div>
  );
}
