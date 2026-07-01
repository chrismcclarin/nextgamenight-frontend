'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, startOfISOWeek, addDays, differenceInMinutes, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { groupsAPI, availabilityAPI } from '../../../../../lib/api';
import { toast } from 'sonner';

const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

export default function AvailabilityResponsePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = Auth();
  const groupId = params.id;
  const weekStartParam = searchParams.get('week');

  const [group, setGroup] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [cannotMakeIt, setCannotMakeIt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [weekStart, setWeekStart] = useState(null);

  useEffect(() => {
    if (groupId && user?.sub) {
      fetchGroup();
      calculateWeekStart();
    }
  }, [groupId, weekStartParam, user]);

  const fetchGroup = async () => {
    try {
      const data = await groupsAPI.getGroup(groupId);
      setGroup(data);
    } catch (error) {
      console.error('Error fetching group:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateWeekStart = () => {
    if (weekStartParam) {
      // Use provided week start (should be Monday)
      setWeekStart(new Date(weekStartParam));
    } else {
      // Calculate Monday of current week
      const today = new Date();
      const monday = startOfISOWeek(today);
      setWeekStart(monday);
    }
  };

  const handleSelectSlot = ({ start, end }) => {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return;
    }

    if (end <= start) {
      return;
    }

    // Check if this slot overlaps with existing slots
    const overlaps = availableSlots.some(slot => {
      const slotStart = parseISO(`${slot.date}T${slot.start_time}`);
      const slotEnd = parseISO(`${slot.date}T${slot.end_time}`);

      // Check if dates are the same
      if (format(start, 'yyyy-MM-dd') !== slot.date) {
        return false;
      }

      // Check for overlap
      return (start < slotEnd && end > slotStart);
    });

    if (overlaps) {
      // Remove overlapping slot and add new one
      const newSlots = availableSlots.filter(slot => {
        const slotStart = parseISO(`${slot.date}T${slot.start_time}`);
        const slotEnd = parseISO(`${slot.date}T${slot.end_time}`);
        return !(format(start, 'yyyy-MM-dd') === slot.date && start < slotEnd && end > slotStart);
      });

      newSlots.push({
        date: format(start, 'yyyy-MM-dd'),
        start_time: format(start, 'HH:mm'),
        end_time: format(end, 'HH:mm'),
      });

      setAvailableSlots(newSlots);
    } else {
      // Add new slot
      setAvailableSlots([
        ...availableSlots,
        {
          date: format(start, 'yyyy-MM-dd'),
          start_time: format(start, 'HH:mm'),
          end_time: format(end, 'HH:mm'),
        },
      ]);
    }
  };

  const removeSlot = (index) => {
    setAvailableSlots(availableSlots.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (cannotMakeIt && availableSlots.length > 0) {
      toast.error('Please either mark "I can\'t make it this week" OR select available time slots, not both.');
      return;
    }

    if (!cannotMakeIt && availableSlots.length === 0) {
      toast.error('Please select at least one time slot when you\'re available, or mark "I can\'t make it this week".');
      return;
    }

    setSubmitting(true);
    try {
      await availabilityAPI.submitWeeklyAvailability(groupId, {
        week_start: format(weekStart, 'yyyy-MM-dd'),
        available_slots: cannotMakeIt ? [] : availableSlots,
        cannot_make_it: cannotMakeIt,
      });

      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting availability:', error);
      toast.error('Error submitting availability: ' + (error.message || 'Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Convert available slots to calendar events for display
  const calendarEvents = availableSlots.map((slot, index) => {
    const start = parseISO(`${slot.date}T${slot.start_time}`);
    const end = parseISO(`${slot.date}T${slot.end_time}`);
    return {
      id: index,
      title: 'Available',
      start,
      end,
    };
  });

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <p className="text-content-secondary">Loading...</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-status-success/10 border border-status-success/30 rounded-card p-6 text-center">
          <h2 className="text-xl font-semibold text-status-success mb-2">Thanks!</h2>
          <p className="text-content-secondary mb-4">Your availability has been recorded.</p>
          <button
            onClick={() => router.push(`/groupHomePage?id=${groupId}`)}
            className="btn btn-primary"
          >
            Back to Group
          </button>
        </div>
      </div>
    );
  }

  if (!weekStart) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-content-secondary">Calculating week...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-content-primary mb-2">
          When are you available this week?
        </h1>
        <p className="text-content-secondary">
          Week of {format(weekStart, 'MMMM d, yyyy')} - {format(addDays(weekStart, 6), 'MMMM d, yyyy')}
        </p>
        {group && (
          <p className="text-sm text-content-muted mt-1">Group: {group.name}</p>
        )}
      </div>

      <div className="mb-4">
        <p className="text-sm text-content-secondary">
          {availableSlots.length > 0
            ? `You've marked ${availableSlots.length} time slot${availableSlots.length === 1 ? '' : 's'} as available`
            : 'No time slots selected yet'}
        </p>
      </div>

      <div className="mb-6">
        <div className="h-[400px] md:h-[600px] bg-surface-card rounded-card border border-line overflow-hidden mb-4">
          <Calendar
            localizer={localizer}
            selectable
            onSelectSlot={handleSelectSlot}
            defaultView="week"
            views={['week']}
            step={30}
            timeslots={1}
            min={new Date(0, 0, 0, 16, 0)} // 4 PM
            max={new Date(0, 0, 0, 23, 59)} // 11:59 PM
            defaultDate={weekStart}
            date={weekStart}
            events={calendarEvents}
            className="h-full"
            style={{ height: '100%' }}
            eventPropGetter={() => ({
              style: {
                backgroundColor: 'var(--color-accent)',
                borderColor: 'var(--color-accent)',
                color: 'white',
                borderRadius: '4px',
              },
            })}
          />
        </div>

        {availableSlots.length > 0 && (
          <div className="bg-accent/10 border border-accent/30 rounded-card p-4">
            <h3 className="font-semibold text-content-primary mb-2">Selected Time Slots:</h3>
            <div className="space-y-2">
              {availableSlots.map((slot, index) => (
                <div key={index} className="flex items-center justify-between bg-surface-card p-2 rounded-btn border border-line">
                  <span className="text-sm text-content-secondary">
                    {format(parseISO(`${slot.date}T${slot.start_time}`), 'EEEE, MMMM d')} - {slot.start_time} to {slot.end_time}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSlot(index)}
                    className="text-xs text-status-error hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-6">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={cannotMakeIt}
            onChange={(e) => {
              setCannotMakeIt(e.target.checked);
              if (e.target.checked) {
                setAvailableSlots([]);
              }
            }}
            className="rounded"
          />
          <span className="text-content-primary">I can't make it this week</span>
        </label>
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleSubmit}
          disabled={submitting || (cannotMakeIt ? false : availableSlots.length === 0)}
          className="btn btn-primary flex-1 py-3"
        >
          {submitting ? 'Submitting...' : 'Submit Availability'}
        </button>
        <button
          onClick={() => router.push(`/groupHomePage?id=${groupId}`)}
          className="btn btn-secondary flex-1 py-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
