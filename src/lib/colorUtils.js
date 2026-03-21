/**
 * Color brightness calculation and text contrast utilities.
 *
 * Consolidates the brightness formula (r*299 + g*587 + b*114) / 1000
 * that was previously duplicated across 8+ frontend files.
 *
 * Dark-mode note: Color constants are defined at the top of the file
 * for easy swapping when dark mode is added.
 */

// --- Title text color constants ---
const TITLE_DARK = '#1f2937';
const TITLE_LIGHT = '#ffffff';

// --- Subtitle text color constants ---
const SUBTITLE_VERY_LIGHT_BG = '#374151';
const SUBTITLE_MEDIUM_LIGHT_BG = '#4b5563';
const SUBTITLE_DARK_BG = 'rgba(255, 255, 255, 0.95)';

// --- Calendar tile text color constants ---
const TILE_TEXT_LIGHT_BG = '#1e40af'; // Blue text on light calendar tiles
const TILE_TEXT_DARK_BG = '#ffffff';

// --- Standard contrast color constants ---
const CONTRAST_DARK = '#1f2937';
const CONTRAST_LIGHT = '#ffffff';

// --- Shadow presets ---
const SHADOW_NONE = 'none';
const SHADOW_LIGHT_SUBTLE = '1px 1px 2px rgba(255, 255, 255, 0.8), -1px -1px 2px rgba(255, 255, 255, 0.8)';
const SHADOW_LIGHT_MEDIUM = '1px 1px 3px rgba(255, 255, 255, 0.9)';
const SHADOW_DARK_HEAVY = '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8), 1px -1px 2px rgba(0, 0, 0, 0.8), -1px 1px 2px rgba(0, 0, 0, 0.8)';
const STROKE_DARK = '0.5px rgba(0, 0, 0, 0.9)';

/**
 * Calculate perceived brightness of a hex color.
 * Uses the W3C formula: (r * 299 + g * 587 + b * 114) / 1000.
 *
 * @param {string} hexColor - Hex color string (with or without '#')
 * @returns {number} Brightness value 0-255. Returns 255 (light) for invalid/missing input.
 */
export function getBrightness(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return 255;

  try {
    const hex = hexColor.replace('#', '');
    if (hex.length < 6) return 255;

    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) return 255;

    return (r * 299 + g * 587 + b * 114) / 1000;
  } catch {
    return 255;
  }
}

/**
 * Standard contrast color for a background.
 * Returns dark gray for light backgrounds, white for dark backgrounds.
 * Used in EventCalendar list-view and similar contexts.
 *
 * @param {string} hexColor - Background hex color
 * @returns {string} '#1f2937' (dark) or '#ffffff' (white)
 */
export function getContrastColor(hexColor) {
  const brightness = getBrightness(hexColor);
  return brightness > 128 ? CONTRAST_DARK : CONTRAST_LIGHT;
}

/**
 * Calendar-tile text color variant.
 * Returns blue for light backgrounds (design choice for calendar event tiles),
 * white for dark backgrounds.
 * Intentionally different from getContrastColor.
 *
 * @param {string} hexColor - Background hex color
 * @returns {string} '#1e40af' (blue) or '#ffffff' (white)
 */
export function getEventTileTextColor(hexColor) {
  if (!hexColor || hexColor === '#ffffff') return TILE_TEXT_LIGHT_BG;
  const brightness = getBrightness(hexColor);
  return brightness > 128 ? TILE_TEXT_LIGHT_BG : TILE_TEXT_DARK_BG;
}

/**
 * Full-featured text style for titles on colored/image backgrounds.
 * Returns an object with color, textShadow, and optionally WebkitTextStroke and fontWeight.
 * Three brightness tiers for solid backgrounds, special handling for background images
 * and null/white backgrounds.
 *
 * Matches the canonical implementation from grouplist.js getTextStyleWithOutline.
 *
 * @param {boolean} hasBackgroundImage - Whether the element has a background image
 * @param {string} backgroundColor - Background hex color
 * @returns {{ color: string, textShadow: string, WebkitTextStroke?: string, fontWeight?: string }}
 */
export function getTextStyle(hasBackgroundImage, backgroundColor) {
  // Background image: always white text with dark outline for readability
  if (hasBackgroundImage) {
    return {
      color: TITLE_LIGHT,
      textShadow: SHADOW_DARK_HEAVY,
      WebkitTextStroke: STROKE_DARK,
      fontWeight: '600',
    };
  }

  // Null or white background: dark text, no shadow
  if (!backgroundColor || backgroundColor === '#ffffff') {
    return {
      color: TITLE_DARK,
      textShadow: SHADOW_NONE,
    };
  }

  const brightness = getBrightness(backgroundColor);

  if (brightness > 180) {
    // Very light background: dark text with light outline
    return {
      color: TITLE_DARK,
      textShadow: SHADOW_LIGHT_SUBTLE,
      fontWeight: '600',
    };
  } else if (brightness > 128) {
    // Medium-light background: dark text with subtle outline
    return {
      color: TITLE_DARK,
      textShadow: SHADOW_LIGHT_MEDIUM,
      fontWeight: '600',
    };
  } else {
    // Dark background: white text with dark outline
    return {
      color: TITLE_LIGHT,
      textShadow: SHADOW_DARK_HEAVY,
      WebkitTextStroke: STROKE_DARK,
      fontWeight: '600',
    };
  }
}

/**
 * Text style for subtitles on colored/image backgrounds.
 * Same tier logic as getTextStyle but with slightly different shades
 * (softer colors for subtitle hierarchy).
 *
 * Matches the subtitle styling from groupHomePage lines 316-349.
 *
 * @param {boolean} hasBackgroundImage - Whether the element has a background image
 * @param {string} backgroundColor - Background hex color
 * @returns {{ color: string, textShadow: string, WebkitTextStroke?: string }}
 */
export function getSubtitleStyle(hasBackgroundImage, backgroundColor) {
  // Background image: off-white text with dark outline
  if (hasBackgroundImage) {
    return {
      color: SUBTITLE_DARK_BG,
      textShadow: SHADOW_DARK_HEAVY,
      WebkitTextStroke: STROKE_DARK,
    };
  }

  // Null or white background: dark subtitle text, no shadow
  if (!backgroundColor || backgroundColor === '#ffffff') {
    return {
      color: SUBTITLE_VERY_LIGHT_BG,
      textShadow: SHADOW_NONE,
    };
  }

  const brightness = getBrightness(backgroundColor);

  if (brightness > 180) {
    // Very light background
    return {
      color: SUBTITLE_VERY_LIGHT_BG,
      textShadow: '1px 1px 2px rgba(255, 255, 255, 0.8)',
    };
  } else if (brightness > 128) {
    // Medium-light background
    return {
      color: SUBTITLE_MEDIUM_LIGHT_BG,
      textShadow: '1px 1px 2px rgba(255, 255, 255, 0.9)',
    };
  } else {
    // Dark background
    return {
      color: SUBTITLE_DARK_BG,
      textShadow: SHADOW_DARK_HEAVY,
      WebkitTextStroke: STROKE_DARK,
    };
  }
}

/**
 * Get text style with outline - alias for getTextStyle.
 * Provided for backward compatibility with the original function name.
 *
 * @param {boolean} hasBackgroundImage - Whether the element has a background image
 * @param {string} backgroundColor - Background hex color
 * @returns {{ color: string, textShadow: string, WebkitTextStroke?: string, fontWeight?: string }}
 */
export function getTextStyleWithOutline(hasBackgroundImage, backgroundColor) {
  return getTextStyle(hasBackgroundImage, backgroundColor);
}
