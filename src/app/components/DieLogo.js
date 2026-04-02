export default function DieLogo({ size = 36 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Periodic Tabletop logo"
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
