'use client';
import { useState, useEffect, useCallback } from 'react';
import { rsvpAPI } from '../../lib/api';
import ClickableMemberName from './ClickableMemberName';

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

  const isPastEvent = eventDate ? new Date(eventDate) < new Date() : false;

  const fetchRsvps = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const data = await rsvpAPI.getEventRsvps(eventId);
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
  }, [eventId, self?.id]);

  useEffect(() => {
    fetchRsvps();
  }, [fetchRsvps]);

  const handleStatusClick = async (status) => {
    if (submitting || isPastEvent) return;
    setSubmitting(status);
    setError(null);
    try {
      const result = await rsvpAPI.submitRsvp(eventId, status, note || null);
      setUserRsvp(result);
      setSelectedStatus(status);
      if (result.note !== undefined) setNote(result.note || '');
      await fetchRsvps();
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

  const grouped = {
    yes: rsvps.filter(r => r.status === 'yes'),
    maybe: rsvps.filter(r => r.status === 'maybe'),
    no: rsvps.filter(r => r.status === 'no'),
  };

  const statusConfig = {
    yes: {
      label: "You're going!",
      textColor: 'text-status-success',
      activeBg: 'bg-status-success/10',
      activeBorder: 'border-status-success',
      hoverBg: 'hover:bg-status-success/10',
      buttonText: 'Yes',
      sectionTitle: 'Going',
    },
    maybe: {
      label: "You're a maybe",
      textColor: 'text-status-warning',
      activeBg: 'bg-status-warning/10',
      activeBorder: 'border-status-warning',
      hoverBg: 'hover:bg-status-warning/10',
      buttonText: 'Maybe',
      sectionTitle: 'Maybe',
    },
    no: {
      label: "You're not going",
      textColor: 'text-content-secondary',
      activeBg: 'bg-surface-elevated',
      activeBorder: 'border-line-strong',
      hoverBg: 'hover:bg-status-error/10',
      buttonText: 'No',
      sectionTitle: "Can't Make It",
    },
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
          <div className="flex rounded-card border border-line overflow-hidden">
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
                    ${idx > 0 ? 'border-l border-line' : ''}
                    ${isActive
                      ? `${config.activeBg} ${config.activeBorder} border-2 text-content-primary`
                      : `bg-surface-card ${config.hoverBg} text-content-secondary`
                    }
                    ${submitting && !isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {isLoading ? (
                    <span className="inline-block animate-spin h-4 w-4 border-2 border-line-strong border-t-transparent rounded-full" />
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
            <textarea
              value={note}
              onChange={(e) => {
                if (e.target.value.length <= 500) {
                  setNote(e.target.value);
                }
              }}
              placeholder="Add a note (optional)"
              rows={2}
              className="w-full border border-line rounded-card px-3 py-2 text-sm bg-surface-input text-content-primary focus:outline-none focus:ring-2 ring-focus-ring resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-content-muted">{note.length}/500</span>
              <button
                onClick={handleSaveNote}
                disabled={savingNote}
                className="btn btn-primary text-sm px-3 py-1"
              >
                {savingNote ? 'Saving...' : 'Save note'}
              </button>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-sm text-status-error">{error}</p>
        )}

        {/* Count banner */}
        {totalResponses > 0 && (
          <div className="flex items-center gap-3 text-sm">
            {summary.yes > 0 && (
              <span className="text-status-success font-medium">{summary.yes} Yes</span>
            )}
            {summary.yes > 0 && (summary.maybe > 0 || summary.no > 0) && (
              <span className="text-line-strong">|</span>
            )}
            {summary.maybe > 0 && (
              <span className="text-status-warning font-medium">{summary.maybe} Maybe</span>
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
