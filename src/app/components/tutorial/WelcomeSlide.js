'use client';

import { TOTAL_SLIDES } from './steps';

/**
 * Full-screen welcome slide shown at the start of the tutorial.
 * Offers "Get Started" to begin the tour or "Skip" to dismiss.
 */
export default function WelcomeSlide({ onStart, onSkip }) {
  const currentPosition = 0;

  return (
    <div className="fixed inset-0 z-[9998] bg-[#fef9ef] flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* App icon placeholder */}
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl font-bold">NG</span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">Next Game Night</h1>

        <p className="text-gray-600 text-base mb-8">
          Schedule game nights, track sessions, and keep your group connected.
        </p>

        <button
          onClick={onStart}
          className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-base"
        >
          Get Started
        </button>

        <button
          onClick={onSkip}
          className="mt-4 text-sm text-gray-400 hover:text-gray-600 underline transition-colors"
        >
          Skip
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
