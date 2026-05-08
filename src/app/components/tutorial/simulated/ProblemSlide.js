'use client';

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
      <h2 className="text-content-primary text-2xl font-semibold mb-6">
        Coordinating game nights is hard.
      </h2>
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
      <p
        className="text-content-primary text-lg font-semibold pt-4 transition-opacity duration-500"
        style={{ opacity: stage >= 4 ? 1 : 0 }}
      >
        Nextgamenight handles availability for you.
      </p>
    </div>
  );
}
