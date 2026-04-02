'use client';

import { useState } from 'react';

/**
 * Muted color palette for fallback backgrounds.
 * Board-game-friendly colors with reduced saturation for theme compatibility.
 * These use HSL values that work well in both light and dark modes.
 */
const FALLBACK_COLORS = [
  'hsl(215, 35%, 48%)',  // steel blue
  'hsl(118, 22%, 46%)',  // sage green
  'hsl(210, 12%, 49%)',  // slate
  'hsl(275, 18%, 49%)',  // muted purple
  'hsl(168, 33%, 45%)',  // teal
  'hsl(30, 31%, 41%)',   // warm brown
  'hsl(213, 32%, 52%)',  // nordic blue
  'hsl(90, 16%, 48%)',   // olive green
  'hsl(25, 30%, 47%)',   // copper
  'hsl(218, 19%, 50%)',  // dusty blue
];

/**
 * Derive a consistent background color from a string.
 * Uses a simple character code hash to pick from the palette.
 *
 * @param {string} text - Text to derive color from (typically alt text / name)
 * @returns {string} HSL color from the palette
 */
function getColorFromText(text) {
  if (!text) return 'var(--color-surface-card-hover)';

  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash += text.charCodeAt(i);
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/**
 * Image component with colored-icon fallback on error.
 *
 * Renders a standard <img> element. On load error, replaces it with a
 * colored placeholder div showing a fallback icon (default: dice emoji).
 * The placeholder background color is derived from the alt text so the
 * same name always produces the same color.
 *
 * @param {object} props
 * @param {string} props.src - Image URL
 * @param {string} props.alt - Alt text (also used for fallback color derivation)
 * @param {string} [props.fallbackIcon='🎲'] - Emoji or text for the fallback
 * @param {string} [props.className] - Applied to both img and fallback div
 * @param {string} [props.imgClassName] - Additional classes for img only
 * @param {object} rest - Passed through to img (style, onClick, etc.)
 */
export default function SafeImage({
  src,
  alt,
  fallbackIcon = '\u{1F3B2}',
  className = '',
  imgClassName = '',
  ...rest
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    const bgColor = getColorFromText(alt);
    return (
      <div
        className={`flex items-center justify-center rounded ${className}`}
        style={{ backgroundColor: bgColor }}
        role="img"
        aria-label={alt || 'Image placeholder'}
      >
        <span className="text-2xl">{fallbackIcon}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      className={`${className} ${imgClassName}`.trim()}
      onError={() => setHasError(true)}
      {...rest}
    />
  );
}
