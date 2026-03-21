'use client';

import { useState } from 'react';

/**
 * Muted color palette for fallback backgrounds.
 * Board-game-friendly colors: blues, greens, teals, purples.
 */
const FALLBACK_COLORS = [
  '#4a6fa5', // steel blue
  '#5b8c5a', // sage green
  '#6b7a8d', // slate
  '#7c6992', // muted purple
  '#4e9a8d', // teal
  '#8b6f47', // warm brown
  '#5e81ac', // nordic blue
  '#7d8f69', // olive green
  '#9b7653', // copper
  '#6a7b99', // dusty blue
];

/**
 * Derive a consistent background color from a string.
 * Uses a simple character code hash to pick from the palette.
 *
 * @param {string} text - Text to derive color from (typically alt text / name)
 * @returns {string} Hex color from the palette
 */
function getColorFromText(text) {
  if (!text) return '#9ca3af'; // default gray for empty alt

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
