// DECISION Phase 88.9-52 (found by the R21 fixer, orchestrator ruling 2026-11-18): the logo is
// DECORATION, hidden from assistive tech, with no label and no prop to give it one; chosen OVER
// keeping a label (it read the legacy name of one group, so the header's home link was spoken with
// that name in front of the product's) and OVER a decorative prop that defaults to labelled (the
// default would still speak the wrong name). Both call sites already have the product named next
// to the logo: the header's home link holds the site name as text (visible, or kept for screen
// readers when the word gives way to the logo), and the landing hero sits under that header.
// A future site that shows the logo with NO name beside it names its own container. Adding a label
// here is a decision, not a cleanup.
export default function DieLogo({ size = 36 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {/* Die face */}
      <rect x="1" y="1" width="38" height="38" rx="8" style={{ fill: 'var(--color-bg-nav)' }} />
      <rect x="1" y="1" width="38" height="38" rx="8" stroke="#d97706" strokeWidth="2" />
      {/* 4 pips at corners */}
      <circle cx="11.5" cy="11.5" r="3.5" fill="#d97706" />
      <circle cx="28.5" cy="11.5" r="3.5" fill="#d97706" />
      <circle cx="11.5" cy="28.5" r="3.5" fill="#d97706" />
      <circle cx="28.5" cy="28.5" r="3.5" fill="#d97706" />
      {/* N centered */}
      <text
        x="20"
        y="25.5"
        textAnchor="middle"
        fill="white"
        fontSize="15"
        fontWeight="800"
        fontFamily="Inter, system-ui, sans-serif"
      >
        N
      </text>
    </svg>
  );
}
