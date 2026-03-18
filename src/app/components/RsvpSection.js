'use client';
import { useState, useEffect, useCallback } from 'react';
import { rsvpAPI } from '../../lib/api';

/**
 * RsvpSection - RSVP interface for a single event
 * Shows status buttons, note field, count banner, and grouped respondent list
 *
 * @param {string} eventId - UUID of the event
 * @param {string} currentUserId - Auth0 user ID (user.sub)
 * @param {string|Date} eventDate - Event start date for past-event check
 */
export default function RsvpSection({ eventId, currentUserId, eventDate, onRsvpChange }) {
  const [rsvps, setRsvps] = useState([]);
  const [summary, setSummary] = useState({ yes: 0, maybe: 0, no: 0 });
  const [userRsvp, setUserRsvp] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(null); // tracks which button is loading
  const [savingNote, setSavingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isPastEvent = eventDate ? new Date(eventDate) < new Date() : false;

  const fetchRsvps = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const data = await rsvpAPI.getEventRsvps(eventId);
      setRsvps(data.rsvps || []);
      setSummary(data.summary || { yes: 0, maybe: 0, no: 0 });

      // Find current user's RSVP
      if (currentUserId) {
        const mine = (data.rsvps || []).find(r => r.user_id === currentUserId);
        if (mine) {
          setUserRsvp(mine);
          setSelectedStatus(mine.status);
          setNote(mine.note || '');
        } else {
          setUserRsvp(null);
          setSelectedStatus(null);
          setNote('');
        }
      }
    } catch (err) {
      console.error('Error fetching RSVPs:', err);
      setError('Could not load RSVPs');
    } finally {
      setLoading(false);
    }
  }, [eventId, currentUserId]);

  useEffect(() => {
    fetchRsvps();
  }, [fetchRsvps]);

  const handleStatusClick = async (status) => {
    if (submitting || isPastEvent) return;
    setSubmitting(status);
    setError(null);
    try {
      const result = await rsvpAPI.submitRsvp(eventId, status, note || null);
      // Update local state immediately
      setUserRsvp(result);
      setSelectedStatus(status);
      if (result.note !== undefined) setNote(result.note || '');
      // Re-fetch to get updated summary and full list
      await fetchRsvps();
      // Notify parent of RSVP change
      if (onRsvpChange) onRsvpChange(status);
    } catch (err) {
      console.error('Error submitting RSVP:', err);
      setError('Could not save your response. Please try again.');
    } finally {
      setSubmitting(null);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedStatus || savingNote) return;
    setSavingNote(true);
    setError(null);
    try {
      await rsvpAPI.submitRsvp(eventId, selectedStatus, note || null);
      await fetchRsvps();
    } catch (err) {
      console.error('Error saving note:', err);
      setError('Could not save your note. Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  // Group rsvps by status
  const grouped = {
    yes: rsvps.filter(r => r.status === 'yes'),
    maybe: rsvps.filter(r => r.status === 'maybe'),
    no: rsvps.filter(r => r.status === 'no'),
  };

  const statusConfig = {
    yes: {
      label: "You're going!",
      textColor: 'text-green-700',
      bgColor: 'bg-green-50',
      activeBg: 'bg-green-100',
      activeBorder: 'border-green-500',
      hoverBg: 'hover:bg-green-50',
      buttonText: 'Yes',
      sectionTitle: 'Going',
    },
    maybe: {
      label: "You're a maybe",
      textColor: 'text-amber-700',
      bgColor: 'bg-amber-50',
      activeBg: 'bg-amber-100',
      activeBorder: 'border-amber-500',
      hoverBg: 'hover:bg-amber-50',
      buttonText: 'Maybe',
      sectionTitle: 'Maybe',
    },
    no: {
      label: "You're not going",
      textColor: 'text-gray-600',
      bgColor: 'bg-gray-50',
      activeBg: 'bg-gray-100',
      activeBorder: 'border-gray-500',
      hoverBg: 'hover:bg-red-50',
      buttonText: 'No',
      sectionTitle: "Can't Make It",
    },
  };

  if (loading) {
    return (
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-500">Loading RSVPs...</p>
      </div>
    );
  }

  const totalResponses = summary.yes + summary.maybe + summary.no;

  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900 text-sm">RSVP</h3>
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
              <p className="text-sm text-gray-500">RSVP to this event</p>
            )}
          </div>
        )}

        {/* Button group - only for future events */}
        {!isPastEvent && (
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {['yes', 'maybe', 'no'].map((status, idx) => {
              const isActive = selectedStatus === status;
              const isLoading = submitting === status;
              const config = statusConfig[status];
              return (
                <button
                  key={status}
                  onClick={() => handleStatusClick(status)}
                  disabled={!!submitting}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition-colors
                    ${idx > 0 ? 'border-l border-gray-300' : ''}
                    ${isActive
                      ? `${config.activeBg} ${config.activeBorder} border-2 text-gray-900`
                      : `bg-white ${config.hoverBg} text-gray-700`
                    }
                    ${submitting && !isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {isLoading ? (
                    <span className="inline-block animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                  ) : (
                    config.buttonText
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Note field - only visible after selecting a status */}
        {!isPastEvent && selectedStatus && (
          <div className="space-y-2">
            <textarea
              value={note}
              onChange={(e) => {
                if (e.target.value.length <= 500) {
                  setNote(e.target.value);
                }
              }}
              placeholder="Add a note (optional)"
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{note.length}/500</span>
              <button
                onClick={handleSaveNote}
                disabled={savingNote}
                className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {savingNote ? 'Saving...' : 'Save note'}
              </button>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* Count banner */}
        {totalResponses > 0 && (
          <div className="flex items-center gap-3 text-sm">
            {summary.yes > 0 && (
              <span className="text-green-700 font-medium">{summary.yes} Yes</span>
            )}
            {summary.yes > 0 && (summary.maybe > 0 || summary.no > 0) && (
              <span className="text-gray-300">|</span>
            )}
            {summary.maybe > 0 && (
              <span className="text-amber-700 font-medium">{summary.maybe} Maybe</span>
            )}
            {summary.maybe > 0 && summary.no > 0 && (
              <span className="text-gray-300">|</span>
            )}
            {summary.no > 0 && (
              <span className="text-gray-500 font-medium">{summary.no} No</span>
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
                        <span className="text-sm text-gray-900">
                          {rsvp.User?.username || 'Unknown'}
                        </span>
                        {rsvp.note && (
                          <span className="text-xs text-gray-500 ml-0 mt-0.5">{rsvp.note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No responses yet</p>
        )}
      </div>
    </div>
  );
}
