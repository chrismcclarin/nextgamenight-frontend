'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, startOfISOWeek, addDays, differenceInMinutes, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { groupsAPI, availabilityAPI } from '../../../../../lib/api';

// Custom styles to match app theme
const calendarStyles = `
  .rbc-calendar {
    font-family: inherit;
    color: #1f2937 !important;
  }
  .rbc-header {
    border-bottom: 2px solid #e5e7eb;
    padding: 8px;
    font-weight: 600;
    color: #1f2937 !important;
    background-color: white !important;
  }
  .rbc-time-header {
    border-bottom: 1px solid #e5e7eb;
    color: #1f2937 !important;
  }
  .rbc-time-header-content {
    color: #1f2937 !important;
  }
  .rbc-time-content {
    border-top: 1px solid #e5e7eb;
  }
  .rbc-time-slot {
    border-top: 1px solid #f3f4f6;
  }
  .rbc-day-slot {
    color: #1f2937 !important;
  }
  .rbc-day-slot .rbc-time-slot {
    border-top: 1px solid #f3f4f6;
  }
  .rbc-time-gutter {
    color: #374151 !important;
    font-weight: 500;
  }
  .rbc-time-gutter .rbc-timeslot-group {
    border-bottom: 1px solid #e5e7eb;
  }
  .rbc-today {
    background-color: #eff6ff;
  }
  .rbc-off-range-bg {
    background-color: #f9fafb;
  }
  .rbc-selected {
    background-color: #dbeafe !important;
  }
  .rbc-slot-selection {
    background-color: #3b82f6 !important;
    opacity: 0.3;
    border: 2px solid #2563eb !important;
  }
  .rbc-event {
    border-radius: 4px;
    padding: 4px 8px;
    background-color: #60a5fa !important;
    border-color: #3b82f6 !important;
    color: white !important;
  }
  .rbc-event-content {
    font-size: 0.875rem;
    font-weight: 500;
    color: white !important;
  }
  .rbc-event-label {
    color: white !important;
  }
  .rbc-toolbar {
    margin-bottom: 1rem;
    color: #1f2937 !important;
  }
  .rbc-toolbar button {
    color: #374151 !important;
    border: 1px solid #d1d5db;
    background-color: white;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
  }
  .rbc-toolbar button:hover {
    background-color: #f3f4f6;
  }
  .rbc-toolbar button.rbc-active {
    background-color: #3b82f6;
    color: white !important;
    border-color: #2563eb;
  }
  .rbc-toolbar-label {
    color: #1f2937 !important;
    font-weight: 600;
  }
  .rbc-time-view {
    border: 1px solid #e5e7eb;
  }
  .rbc-time-header-gutter {
    border-right: 1px solid #e5e7eb;
  }
  .rbc-day-bg {
    border-right: 1px solid #e5e7eb;
  }
  .rbc-day-header {
    color: #1f2937 !important;
  }
  .rbc-label {
    color: #374151 !important;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = calendarStyles;
  document.head.appendChild(styleSheet);
}
import { groupsAPI, availabilityAPI } from '../../../../../lib/api';

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
  const [useVisualCalendar, setUseVisualCalendar] = useState(true);

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
      alert('Please either mark "I can\'t make it this week" OR select available time slots, not both.');
      return;
    }

    if (!cannotMakeIt && availableSlots.length === 0) {
      alert('Please select at least one time slot when you\'re available, or mark "I can\'t make it this week".');
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
      alert('Error submitting availability: ' + (error.message || 'Please try again.'));
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
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold text-green-800 mb-2">Thanks!</h2>
          <p className="text-green-700 mb-4">Your availability has been recorded.</p>
          <button
            onClick={() => router.push(`/groupHomePage?id=${groupId}`)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
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
        <p className="text-gray-600">Calculating week...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">
          When are you available this week?
        </h1>
        <p className="text-gray-600">
          Week of {format(weekStart, 'MMMM d, yyyy')} - {format(addDays(weekStart, 6), 'MMMM d, yyyy')}
        </p>
        {group && (
          <p className="text-sm text-gray-500 mt-1">Group: {group.name}</p>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">
            {availableSlots.length > 0 
              ? `You've marked ${availableSlots.length} time slot${availableSlots.length === 1 ? '' : 's'} as available`
              : 'No time slots selected yet'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUseVisualCalendar(!useVisualCalendar)}
          className="text-xs text-blue-600 hover:text-blue-700 underline"
        >
          {useVisualCalendar ? 'Switch to Manual Entry' : 'Switch to Visual Calendar'}
        </button>
      </div>

      {useVisualCalendar ? (
        <div className="mb-6">
          <div className="h-[400px] md:h-[600px] bg-white rounded-lg border border-gray-300 overflow-hidden mb-4">
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
                  backgroundColor: '#60a5fa',
                  borderColor: '#3b82f6',
                  color: 'white',
                  borderRadius: '4px',
                },
              })}
            />
          </div>

          {availableSlots.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Selected Time Slots:</h3>
              <div className="space-y-2">
                {availableSlots.map((slot, index) => (
                  <div key={index} className="flex items-center justify-between bg-white p-2 rounded border border-blue-200">
                    <span className="text-sm text-blue-700">
                      {format(parseISO(`${slot.date}T${slot.start_time}`), 'EEEE, MMMM d')} - {slot.start_time} to {slot.end_time}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSlot(index)}
                      className="text-xs text-red-600 hover:text-red-700 underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-6 space-y-4">
          <p className="text-sm text-gray-600">
            Manual entry mode - add time slots manually
          </p>
          {/* Manual entry UI can be added here if needed */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              Manual entry interface coming soon. Please use the visual calendar.
            </p>
          </div>
        </div>
      )}

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
          <span className="text-gray-900">I can't make it this week</span>
        </label>
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleSubmit}
          disabled={submitting || (cannotMakeIt ? false : availableSlots.length === 0)}
          className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg text-center hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting...' : 'Submit Availability'}
        </button>
        <button
          onClick={() => router.push(`/groupHomePage?id=${groupId}`)}
          className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg text-center hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
