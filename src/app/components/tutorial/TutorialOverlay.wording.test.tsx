// Phase 88.6.1 plan 51 (D-16, D-30 T2-T4, D-32 R4/R8): the tutorial's gesture wording forks on
// the shared phone-viewport hook. A phone reads "press and hold, then drag"; a desktop keeps
// today's click-and-drag sentences.
//
// Every expected sentence below is typed here as its own literal (straight apostrophe, U+2014 em
// dash) and never imported from the components, so an exact getByText is the byte pin.
//
// The phone arm is chosen by installing a media stub BEFORE render (plan 88.6.1-09's consumer
// idiom). The stub answers true only for the hook's own exported query, so this file never spells
// the breakpoint (plan 09's census VP-C2 counts that literal). With no stub, jsdom's global stub
// answers false for every query (vitest.setup.ts), which is the desktop arm.
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9).

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { PHONE_MEDIA_QUERY } from '@/lib/hooks/usePhoneViewport';
import TutorialOverlay from './TutorialOverlay';
import ScheduleDemo from './simulated/ScheduleDemo';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Phone arm: copy rows T2, T3, T4 (D-30) and R4 (D-32), apostrophes straight (R8).
const T2_PHONE = "Tap a time, or press and hold then drag across the times you're available — takes 30 seconds.";
const T3_PHONE = 'Press and hold, then drag across the peak to schedule.';
const T4_PHONE = 'Press and hold, then drag to set the time window — same gesture as availability.';
const R4_PHONE = 'Press and hold, then drag to schedule across the peak';

// Desktop arm: today's sentences, unchanged (D-16, copy table note "Desktop keeps").
const T2_DESKTOP = "Click and drag across the times you're available — takes 30 seconds.";
const T3_DESKTOP = 'Drag across the peak to schedule.';
const T4_DESKTOP = 'Click and drag to set the time window — same gesture as availability.';
const R4_DESKTOP = 'Drag to schedule across the peak';

let matchMediaSpy: MockInstance<typeof window.matchMedia> | null = null;

// The house stub shape (EventScheduler.test.tsx, function stubMatchMedia), answering true only
// for the hook's query.
function installPhoneStub() {
  matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === PHONE_MEDIA_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

// Synchronous presses only: no stage timer fires inside one synchronous test body, so every step
// stays at stage 0 (the schedule step therefore shows its hint, not the event-created line).
function pressNext(times: number) {
  for (let i = 0; i < times; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
  }
}

describe('tutorial gesture wording — phone and desktop arms (88.6.1-51, D-16)', () => {
  afterEach(() => {
    cleanup();
    matchMediaSpy?.mockRestore();
    matchMediaSpy = null;
  });

  it('T51-1. phone: the availability step shows copy row T2 and not the desktop sentence', () => {
    installPhoneStub();
    render(<TutorialOverlay onComplete={vi.fn()} />);
    pressNext(3);
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument();
    // Positive signal first (CF-26), then the absence.
    expect(screen.getByText(T2_PHONE)).toBeInTheDocument();
    expect(screen.queryByText(T2_DESKTOP)).toBeNull();
  });

  it('T51-2. phone: the schedule step shows T3 (still the p pseudo-heading), T4 and R4, and no desktop sentence', () => {
    installPhoneStub();
    render(<TutorialOverlay onComplete={vi.fn()} />);
    pressNext(5);
    expect(screen.getByText('Step 5 of 6')).toBeInTheDocument();
    const lead = screen.getByText(T3_PHONE);
    // DECISION Phase 88.6-35: the scene lead stays a p element with the pseudo-heading classes.
    expect(lead.tagName).toBe('P');
    expect(lead).toHaveClass('text-xl');
    expect(lead).toHaveClass('font-bold');
    expect(screen.getByText(T4_PHONE)).toBeInTheDocument();
    expect(screen.getByText(R4_PHONE)).toBeInTheDocument();
    expect(screen.queryByText(T3_DESKTOP)).toBeNull();
    expect(screen.queryByText(T4_DESKTOP)).toBeNull();
    expect(screen.queryByText(R4_DESKTOP)).toBeNull();
  });

  it('T51-3. desktop (CONFIRM-ONLY: green before and after the change): no stub keeps today\'s four sentences', () => {
    render(<TutorialOverlay onComplete={vi.fn()} />);
    pressNext(3);
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument();
    expect(screen.getByText(T2_DESKTOP)).toBeInTheDocument();
    expect(screen.queryByText(T2_PHONE)).toBeNull();
    pressNext(2);
    expect(screen.getByText('Step 5 of 6')).toBeInTheDocument();
    expect(screen.getByText(T3_DESKTOP)).toBeInTheDocument();
    expect(screen.getByText(T4_DESKTOP)).toBeInTheDocument();
    expect(screen.getByText(R4_DESKTOP)).toBeInTheDocument();
    expect(screen.queryByText(T3_PHONE)).toBeNull();
    expect(screen.queryByText(T4_PHONE)).toBeNull();
    expect(screen.queryByText(R4_PHONE)).toBeNull();
  });

  it('T51-4. ScheduleDemo follows its prop only: under a phone stub without the prop it shows the desktop badge', () => {
    installPhoneStub();
    const { unmount } = render(<ScheduleDemo stage={0} />);
    // It never reads the viewport itself, so the phone stub changes nothing here.
    expect(screen.getByText(R4_DESKTOP)).toBeInTheDocument();
    expect(screen.queryByText(R4_PHONE)).toBeNull();
    unmount();
    render(<ScheduleDemo stage={0} isPhoneViewport />);
    expect(screen.getByText(R4_PHONE)).toBeInTheDocument();
    expect(screen.queryByText(R4_DESKTOP)).toBeNull();
  });
});
