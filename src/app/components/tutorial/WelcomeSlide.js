'use client';

import { TOTAL_SLIDES } from './steps';

/**
 * Full-screen welcome slide shown at the start of the tutorial.
 * Offers "Get Started" to begin the tour or "Skip" to dismiss.
 */
export default function WelcomeSlide({ onStart, onSkip }) {
  const currentPosition = 0;

  return (
    <div className="fixed inset-0 z-[9998] bg-surface-page flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* App icon placeholder */}
        <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl font-bold">NG</span>
        </div>

        <h1 className="text-3xl font-bold text-content-primary mb-3">Next Game Night</h1>

        <p className="text-content-secondary text-base mb-8">
          Schedule game nights, track sessions, and keep your group connected.
        </p>

        <button
          onClick={onStart}
          className="w-full bg-accent btn btn-primary py-3 px-6 font-semibold transition-colors text-base"
        >
          Get Started
        </button>

        <button
          onClick={onSkip}
          className="mt-4 text-sm text-content-muted hover:text-content-secondary underline transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Step dots at bottom */}
      <div className="absolute bottom-8 flex gap-1.5">
        {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
          <span
            key={i}
            className={`w-2 h-2 rounded-full ${i <= currentPosition ? 'bg-accent' : 'bg-line'}`}
          />
        ))}
      </div>
    </div>
  );
}
