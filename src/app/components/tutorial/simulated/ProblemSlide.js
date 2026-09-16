'use client';

import { Heading } from '../../../../components/ui/Heading';

/**
 * ProblemSlide — Step 1 of 5.
 *
 * Sets up why the product exists. Three short pain points fade in on a
 * staggered timer to make the "this is broken" feeling concrete, then the
 * payoff line lands. No grid yet — just text. The rest of the tutorial
 * shows the system that solves these.
 */
export default function ProblemSlide({ stage }) {
  return (
    <div className="max-w-xl text-center space-y-4">
      <Heading level={2} size="heading" className="text-content-primary mb-6">
        Coordinating game nights is hard.
      </Heading>
      <ul className="space-y-3 text-content-secondary text-base">
        <li
          className="transition-all duration-500"
          style={{
            opacity: stage >= 1 ? 1 : 0,
            transform: stage >= 1 ? 'translateY(0)' : 'translateY(8px)',
          }}
        >
          Group chats sprawl. Plans get buried.
        </li>
        <li
          className="transition-all duration-500"
          style={{
            opacity: stage >= 2 ? 1 : 0,
            transform: stage >= 2 ? 'translateY(0)' : 'translateY(8px)',
          }}
        >
          Polls go nowhere — half the group never votes.
        </li>
        <li
          className="transition-all duration-500"
          style={{
            opacity: stage >= 3 ? 1 : 0,
            transform: stage >= 3 ? 'translateY(0)' : 'translateY(8px)',
          }}
        >
          Calendars don&apos;t compare. You guess at when people are free.
        </li>
      </ul>
      {/* DECISION Phase 88.6-35 (UI-SPEC §4.3 residue clause, SPEC P4): this payoff line is a
          PSEUDO-HEADING — `text-lg` residue resolving to `text-xl` / 700 — and stays a `<p>`,
          chosen OVER promoting it to `<Heading level={3}>` now that it wears the Heading rung's
          size and weight. It has no outline position to state: it is the closing beat of the
          `<ul>` above it, not a section title, and any level chosen would be invented. It is
          the fifth member of the set whose other four live in `TutorialOverlay.js`. */}
      <p
        className="text-content-primary text-xl font-bold pt-4 transition-opacity duration-500"
        style={{ opacity: stage >= 4 ? 1 : 0 }}
      >
        Nextgamenight handles availability for you.
      </p>
    </div>
  );
}
