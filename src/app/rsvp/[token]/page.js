'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { rsvpPublicAPI } from '@/lib/api';

/**
 * Page states for the RSVP magic link flow
 */
const PAGE_STATES = {
  LOADING: 'loading',
  SUCCESS: 'success',
  EVENT_PASSED: 'event_passed',
  ERROR: 'error',
};

/**
 * Status display config: message templates, colors, and icons
 */
const STATUS_CONFIG = {
  yes: {
    heading: "You're in!",
    messageTemplate: (name, date) => `See you at ${name} on ${date}.`,
    accent: 'bg-green-100 text-green-800',
    border: 'border-green-500',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
  },
  maybe: {
    heading: 'Got it!',
    messageTemplate: (name, date) => `You're a maybe for ${name} on ${date}.`,
    accent: 'bg-yellow-100 text-yellow-800',
    border: 'border-yellow-500',
    iconBg: 'bg-yellow-100',
    iconColor: 'text-yellow-600',
  },
  no: {
    heading: 'Got it!',
    messageTemplate: (name, date) => `We'll miss you at ${name} on ${date}.`,
    accent: 'bg-gray-100 text-gray-800',
    border: 'border-gray-400',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-500',
  },
};

/**
 * RsvpPage - Public landing page for magic link RSVP responses
 *
 * Flow:
 * 1. Extracts token from path, e/u/s from query params
 * 2. Calls public RSVP endpoint on mount
 * 3. Shows confirmation (success), event-passed, or error state
 *
 * This page does NOT require Auth0 authentication.
 */
export default function RsvpPage() {
  const { token } = useParams();
  const searchParams = useSearchParams();

  const [pageState, setPageState] = useState(PAGE_STATES.LOADING);
  const [responseData, setResponseData] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null);

  useEffect(() => {
    const submitRsvp = async () => {
      if (!token) {
        setPageState(PAGE_STATES.ERROR);
        return;
      }

      const eventId = searchParams.get('e');
      const userId = searchParams.get('u');
      const status = searchParams.get('s');

      if (!eventId || !userId || !status) {
        setPageState(PAGE_STATES.ERROR);
        return;
      }

      try {
        const result = await rsvpPublicAPI.respondViaToken(token, eventId, userId, status);

        if (result.success) {
          setResponseData(result);
          setPageState(PAGE_STATES.SUCCESS);
        } else if (result.error === 'event_passed') {
          setErrorInfo({
            event_name: result.event_name,
            group_id: result.group_id,
          });
          setPageState(PAGE_STATES.EVENT_PASSED);
        } else if (result.error === 'event_cancelled') {
          setErrorInfo({ group_id: result.group_id });
          setPageState(PAGE_STATES.EVENT_PASSED);
        } else {
          setPageState(PAGE_STATES.ERROR);
        }
      } catch (err) {
        console.error('RSVP submission error:', err);
        setPageState(PAGE_STATES.ERROR);
      }
    };

    submitRsvp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---- LOADING STATE ----
  if (pageState === PAGE_STATES.LOADING) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Recording your RSVP...</p>
        </div>
      </div>
    );
  }

  // ---- SUCCESS STATE ----
  if (pageState === PAGE_STATES.SUCCESS && responseData) {
    const config = STATUS_CONFIG[responseData.status] || STATUS_CONFIG.yes;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className={`max-w-md w-full bg-white rounded-lg shadow-lg overflow-hidden border-t-4 ${config.border}`}>
          <div className="p-8 text-center">
            {/* Icon */}
            <div className={`w-16 h-16 ${config.iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
              {responseData.status === 'yes' && (
                <svg className={`w-8 h-8 ${config.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {responseData.status === 'maybe' && (
                <svg className={`w-8 h-8 ${config.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {responseData.status === 'no' && (
                <svg className={`w-8 h-8 ${config.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>

            {/* Heading */}
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {config.heading}
            </h1>

            {/* Message */}
            <p className="text-gray-600 mb-6">
              {config.messageTemplate(responseData.event_name, responseData.event_date)}
            </p>

            {/* Group name */}
            {responseData.group_name && (
              <p className="text-sm text-gray-500 mb-6">
                {responseData.group_name}
              </p>
            )}

            {/* Divider and links */}
            <div className="border-t border-gray-200 pt-4">
              <p className="text-sm text-gray-500 mb-2">
                You can safely close this tab.
              </p>
              <p className="text-xs text-gray-400">
                Changed your mind? Click a different RSVP link from the email to update your response.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- EVENT PASSED STATE ----
  if (pageState === PAGE_STATES.EVENT_PASSED) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            This event has already happened
          </h1>
          <p className="text-gray-600 mb-6">
            {errorInfo?.event_name
              ? `${errorInfo.event_name} has already taken place.`
              : 'This event has already taken place or has been cancelled.'}
          </p>
          {errorInfo?.group_id && (
            <a
              href={`/groups/${errorInfo.group_id}`}
              className="inline-block px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              Go to Group
            </a>
          )}
        </div>
      </div>
    );
  }

  // ---- ERROR STATE ----
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-gray-600 mb-6">
          This link may be invalid or expired. Please try clicking the RSVP link from your email again.
        </p>
        <a
          href="/"
          className="inline-block px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          Go to Home
        </a>
      </div>
    </div>
  );
}
