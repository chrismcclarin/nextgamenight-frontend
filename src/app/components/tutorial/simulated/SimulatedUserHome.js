'use client';

import { MOCK_GROUPS } from '../mockData';

/**
 * Simulated UserHome page for the tutorial.
 * Visually mimics the real UserHomePage layout with static mock data.
 * All buttons are inert -- no real functionality.
 */
export default function SimulatedUserHome() {
  return (
    <div className="user-home-container flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 min-h-[500px]">
      {/* Group list sidebar */}
      <div className="w-full md:w-auto md:flex-shrink-0 md:flex-[0_0_400px]">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Your Groups</h2>
            <button
              data-tutorial="create-group-btn"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              onClick={() => {}}
            >
              + Create Group
            </button>
          </div>

          {/* Group cards */}
          <div className="space-y-3">
            {MOCK_GROUPS.map((group) => (
              <div
                key={group.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-default"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: group.color }}
                >
                  {group.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                  <p className="text-xs text-gray-500">{group.memberCount} members</p>
                </div>
              </div>
            ))}
          </div>

          {/* QR code join area */}
          <div
            data-tutorial="qr-join"
            className="mt-4 p-3 border border-dashed border-gray-300 rounded-lg text-center bg-gray-50"
          >
            <div className="text-2xl mb-1">📱</div>
            <p className="text-sm text-gray-600">
              Have a QR code? Scan it to instantly join a group.
            </p>
          </div>
        </div>
      </div>

      {/* Calendar placeholder */}
      <div className="hidden md:block flex-1 min-w-0">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 h-full">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Upcoming Events</h3>
          <div className="space-y-2">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-900">Game Night - Friday 7pm</p>
              <p className="text-xs text-blue-700">Catan with Alex, Jordan, Sam</p>
            </div>
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-medium text-green-900">Weekend Boardgames</p>
              <p className="text-xs text-green-700">Wingspan with Taylor, Alex</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="text-center text-xs text-gray-400 py-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}
              </div>
            ))}
            {Array.from({ length: 28 }).map((_, i) => (
              <div
                key={i}
                className={`text-center text-xs py-2 rounded ${
                  i === 11 || i === 13
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'text-gray-600'
                }`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
