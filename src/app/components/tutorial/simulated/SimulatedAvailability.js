'use client';

import { useState } from 'react';
import { MOCK_AVAILABILITY, MOCK_PLAYERS } from '../mockData';

/**
 * Color scale for heatmap cells based on overlap count (0-4 people).
 * Matches real HeatmapCell: gray -> yellow -> orange -> red (warm scale).
 */
const HEAT_COLORS = [
  'bg-gray-100',                        // 0 - nobody
  'bg-yellow-200 border-yellow-400',    // 1 - light warm
  'bg-yellow-400 border-yellow-500',    // 2 - warm
  'bg-orange-400 border-orange-500',    // 3 - hot
  'bg-red-500 border-red-600 text-white', // 4 - hottest
];

/**
 * Simulated Availability page for the tutorial.
 * Shows a pre-filled heatmap of group availability and an interactive
 * "Your Availability" section where users can toggle time slots.
 */
export default function SimulatedAvailability() {
  // Local state for interactive slot selection (discarded when tutorial ends)
  const [selectedSlots, setSelectedSlots] = useState(new Set());

  const interactiveDays = MOCK_AVAILABILITY.days;
  const interactiveSlots = ['6:00 PM', '7:00 PM', '8:00 PM'];

  const toggleSlot = (key) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="p-3 md:p-6 min-h-[500px]">
      {/* Breadcrumbs */}
      <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
        <span className="text-blue-400 font-medium">Home</span>
        <span className="text-gray-400 mx-2">{'>'}</span>
        <span className="text-blue-400 font-medium">Friday Night Games</span>
        <span className="text-gray-400 mx-2">{'>'}</span>
        <span className="text-white font-semibold">Availability</span>
      </nav>

      <h2 className="text-xl font-bold text-gray-900 mb-1">Group Availability</h2>
      <p className="text-sm text-gray-600 mb-4">
        {MOCK_PLAYERS.length} members have shared their availability
      </p>

      {/* Heatmap grid */}
      <div
        data-tutorial="availability-heatmap"
        className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-6 overflow-x-auto"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">When is everyone free?</h3>

        {/* Legend - matches real HeatmapGrid */}
        <div className="flex items-center gap-3 mb-3 text-xs">
          <span className="text-gray-500">Fewer available</span>
          <div className="flex gap-0.5">
            <div className="w-5 h-3 rounded-sm bg-gray-100 border border-gray-300" />
            <div className="w-5 h-3 rounded-sm bg-yellow-200 border border-yellow-400" />
            <div className="w-5 h-3 rounded-sm bg-yellow-400 border border-yellow-500" />
            <div className="w-5 h-3 rounded-sm bg-orange-400 border border-orange-500" />
            <div className="w-5 h-3 rounded-sm bg-red-500 border border-red-600" />
          </div>
          <span className="text-gray-500">More available</span>
        </div>

        <div className="min-w-max">
          {/* Day headers */}
          <div className="flex">
            <div className="w-16 flex-shrink-0" />
            {MOCK_AVAILABILITY.days.map((day) => (
              <div
                key={day}
                className="w-14 flex-shrink-0 text-center text-xs font-medium text-gray-600 pb-1"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Heatmap rows */}
          {MOCK_AVAILABILITY.timeSlots.map((time, rowIdx) => (
            <div key={time} className="flex">
              <div className="w-16 flex-shrink-0 text-xs text-gray-500 py-1.5 pr-2 text-right">
                {time}
              </div>
              {MOCK_AVAILABILITY.data[rowIdx].map((count, colIdx) => (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  className={`w-14 h-8 flex-shrink-0 flex items-center justify-center text-xs font-medium rounded-sm m-0.5 border ${
                    HEAT_COLORS[Math.min(count, HEAT_COLORS.length - 1)]
                  }`}
                >
                  {count > 0 ? count : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Interactive "Your Availability" section */}
      <div
        data-tutorial="availability-slots"
        className="bg-white rounded-lg border border-gray-200 shadow-sm p-4"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Your Availability</h3>
        <p className="text-xs text-gray-500 mb-3">Tap slots to mark when you are free</p>

        <div className="min-w-max">
          {/* Day headers */}
          <div className="flex">
            <div className="w-16 flex-shrink-0" />
            {interactiveDays.map((day) => (
              <div
                key={day}
                className="w-14 flex-shrink-0 text-center text-xs font-medium text-gray-600 pb-1"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Toggleable slots */}
          {interactiveSlots.map((time) => (
            <div key={time} className="flex">
              <div className="w-16 flex-shrink-0 text-xs text-gray-500 py-1.5 pr-2 text-right">
                {time}
              </div>
              {interactiveDays.map((day) => {
                const key = `${day}-${time}`;
                const isSelected = selectedSlots.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleSlot(key)}
                    className={`w-14 h-8 flex-shrink-0 rounded-sm m-0.5 text-xs font-medium transition-colors border ${
                      isSelected
                        ? 'bg-blue-500 text-white border-blue-600'
                        : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {isSelected ? '\u2713' : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {selectedSlots.size > 0 && (
          <p className="text-xs text-blue-600 mt-2">
            {selectedSlots.size} slot{selectedSlots.size !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>
    </div>
  );
}
