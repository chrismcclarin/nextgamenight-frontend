'use client';

import { TOTAL_SLIDES } from './steps';

/**
 * Completion slide shown after all tour steps are finished.
 * Displays a checkmark and offers navigation to home.
 */
export default function DoneSlide({ onComplete }) {
  const currentPosition = TOTAL_SLIDES - 1;

  return (
    <div className="fixed inset-0 z-[9998] bg-[#fef9ef] flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Checkmark circle */}
        <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-10 h-10 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">You're all set!</h1>

        <p className="text-gray-600 text-base mb-8">
          You're ready to start scheduling game nights with your group.
        </p>

        <button
          onClick={onComplete}
          className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-base"
        >
          Go to Home
        </button>
      </div>

      {/* Step dots at bottom */}
      <div className="absolute bottom-8 flex gap-1.5">
        {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
          <span
            key={i}
            className={`w-2 h-2 rounded-full ${i <= currentPosition ? 'bg-blue-600' : 'bg-gray-300'}`}
          />
        ))}
      </div>
    </div>
  );
}
