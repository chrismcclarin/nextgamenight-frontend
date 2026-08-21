/**
 * Color brightness calculation and text contrast utilities.
 *
 * Consolidates the brightness formula (r*299 + g*587 + b*114) / 1000
 * that was previously duplicated across 8+ frontend files.
 *
 * Theming note: dark mode SHIPPED in the token layer (globals.css). The raw
 * colour constants below are NOT "waiting to be swapped for dark mode" — they
 * are the computed output poles for text drawn on a USER-CHOSEN group colour,
 * which is theme-independent by definition. Anything that depends on the app
 * theme resolves to a `var(--color-*)` token instead; see the no-colour
 * fallbacks directly below.
 */

/*
 * DECISION Phase 88-22 (D-27/D-29): this file keeps raw numeric colour values
 * ON PURPOSE, chosen OVER converting them to semantic tokens like every other
 * component file in this phase.
 *
 * WHY. The W3C brightness formula (299/587/114, and the 128/180 tier
 * thresholds) and its two output poles are contrast COMPUTATION over a colour
 * the USER picked for their group. They are numeric by nature and have no
 * theme: white title text on a dark group colour must stay white in BOTH
 * themes, so a theme token would actively break it. That is why the poles are
 * literals and not `var(--color-content-*)`.
 *
 * CONSEQUENCE for Req 2's grep gate (plan 88-29): `src/lib/colorUtils.js` goes
 * on the hex allowlist WITH THIS RATIONALE ATTACHED, never as a bare entry — a
 * bare entry reads as a blanket pass and loses the reasoning (D-27). The
 * allowlist covers the computation poles ONLY; the no-colour fallbacks below
 * are tokens and must stay tokens.
 *
 * ALSO (D-29): do NOT collapse the algorithm or delete the two lighter tiers
 * (brightness > 180 and > 128). They are unreachable TODAY only because every
 * shipped preset in `DEFAULT_BACKGROUND_COLORS` is dark; Phase 88.3's
 * light-mode palette may ship light presets that make the dark-text branch
 * load-bearing again, and rebuilding them costs more than carrying them.
 * Deleting them is a decision, not a cleanup.
 */

// --- Title text color constants (computed poles — see DECISION above) ---
const TITLE_DARK = '#1f2937';
const TITLE_LIGHT = '#ffffff';

// --- Subtitle text color constants (computed poles) ---
const SUBTITLE_VERY_LIGHT_BG = '#374151';
const SUBTITLE_MEDIUM_LIGHT_BG = '#4b5563';
const SUBTITLE_DARK_BG = 'rgba(255, 255, 255, 0.95)';

// --- Calendar tile text color constants (computed poles) ---
const TILE_TEXT_LIGHT_BG = '#1e40af'; // Blue text on light calendar tiles
const TILE_TEXT_DARK_BG = '#ffffff';
const TEXT_MUTED_ON_LIGHT_BG = '#6b7280'; // Muted body text on a light ground

// --- Standard contrast color constants (computed poles) ---
const CONTRAST_DARK = '#1f2937';
const CONTRAST_LIGHT = '#ffffff';

/*
 * Exported poles. CalendarListView's `EventRow` and EventDayModal's rows carry
 * their own bespoke contrast branches (different shadow weights from
 * getTextStyle's — a shipped visual, not drift), and used to re-declare these
 * literals locally. Importing them keeps raw colour values in exactly ONE
 * allowlisted file, which is what makes Req 2's grep gate meaningful: a hex
 * value appearing in a component file is then always a defect, never a copy of
 * a legitimate pole.
 */
export const TEXT_ON_LIGHT = CONTRAST_DARK;
export const TEXT_ON_DARK = CONTRAST_LIGHT;
export const SUBTEXT_ON_LIGHT = SUBTITLE_MEDIUM_LIGHT_BG;
export const SUBTEXT_MUTED_ON_LIGHT = TEXT_MUTED_ON_LIGHT_BG;

/*
 * --- No-colour fallbacks (D-28) ---
 *
 * These are THEME tokens, not computation output, and that difference is the
 * whole point. A group with no background colour of its own is rendered on the
 * app's own themed surface (`bg-surface-card` and friends) — so its text must
 * come from the content tokens that were designed against that surface. The
 * previous code returned dark-on-white values here, which is what produced the
 * white-card-in-a-dark-UI defect (M-04, verified live at 375px) and left the
 * secondary line nearly invisible.
 */
const UNSET_BG_TITLE = 'var(--color-content-primary)';
const UNSET_BG_SUBTITLE = 'var(--color-content-secondary)';
const UNSET_BG_TILE_TEXT = 'var(--color-content-primary)';

/**
 * Matches the legacy "no colour chosen" sentinel that the group settings colour
 * picker persisted: white, in either shorthand or full form and any case.
 * `#FFFFFF` and `#fff` were previously NOT recognised by the strict equality
 * check this replaces, so those rows fell through to the very-light tier and
 * rendered a white card anyway.
 */
const UNSET_BACKGROUND_PATTERN = /^#(?:fff|ffffff)$/i;

/**
 * True when a group has no background colour of its own.
 *
 * Stored white counts as unset: the settings picker defaulted to white and
 * persisted it, so white means "never chose one", not "deliberately white".
 *
 * @param {string|null|undefined} color - Stored background colour
 * @returns {boolean}
 */
export function isUnsetBackgroundColor(color) {
  if (!color || typeof color !== 'string') return true;
  return UNSET_BACKGROUND_PATTERN.test(color.trim());
}

/**
 * The background colour to apply INLINE for a group, or `null` when the group
 * has none.
 *
 * Callers MUST omit the `backgroundColor` style property entirely when this
 * returns `null` — spreading `{ backgroundColor: null }` is fine, but hardcoding
 * a fallback colour is not. An inline background beats the themed
 * `bg-surface-*` class, and that override is the exact mechanism of the D-28
 * white-card defect.
 *
 * @param {string|null|undefined} color - Stored background colour
 * @returns {string|null} The colour to apply, or null to defer to the theme
 */
export function resolveGroupBackgroundColor(color) {
  return isUnsetBackgroundColor(color) ? null : color;
}

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
 * @param {string|null|undefined} hexColor - Hex color string (with or without '#')
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
 * @param {string|null|undefined} hexColor - Background hex color
 * @returns {string} The dark pole (slate) or the light pole (white)
 */
export function getContrastColor(hexColor) {
  const brightness = getBrightness(hexColor);
  return brightness > 128 ? CONTRAST_DARK : CONTRAST_LIGHT;
}

/**
 * True when a background is dark enough to need light text.
 *
 * The same predicate as `getContrastColor(c) === <the light pole>`, expressed
 * without the pole so callers never need the literal (Req 2). Note this is only
 * meaningful for a REAL colour: with no colour the element is on the app's
 * themed surface, so ask `isUnsetBackgroundColor` first.
 *
 * @param {string|null|undefined} hexColor - Background hex color
 * @returns {boolean}
 */
export function isDarkBackground(hexColor) {
  return getBrightness(hexColor) <= 128;
}

/**
 * Calendar-tile text color variant.
 * Returns blue for light backgrounds (design choice for calendar event tiles),
 * white for dark backgrounds.
 * Intentionally different from getContrastColor.
 *
 * With no group colour the tile has no background of its own and sits on the
 * themed month cell, so the content token is returned instead of a pole (D-28).
 *
 * @param {string|null|undefined} hexColor - Background hex color
 * @returns {string} A content token (no colour), tile blue, or white
 */
export function getEventTileTextColor(hexColor) {
  if (isUnsetBackgroundColor(hexColor)) return UNSET_BG_TILE_TEXT;
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
 * @param {string|null|undefined} backgroundColor - Background hex color
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

  // No group colour: the element sits on the app's themed surface, so the
  // title takes the content token rather than a computed pole (D-28). No
  // shadow and no stroke — both exist to rescue text from a coloured ground
  // and only muddy it on a token surface.
  if (isUnsetBackgroundColor(backgroundColor)) {
    return {
      color: UNSET_BG_TITLE,
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
 * @param {string|null|undefined} backgroundColor - Background hex color
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

  // No group colour: the secondary/muted line is HALF the D-28 defect — it
  // used to render a mid-slate designed for a white card, on a card that is
  // actually dark. The content-secondary token is the one designed against the
  // themed surface, in either theme.
  if (isUnsetBackgroundColor(backgroundColor)) {
    return {
      color: UNSET_BG_SUBTITLE,
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
 * @param {string|null|undefined} backgroundColor - Background hex color
 * @returns {{ color: string, textShadow: string, WebkitTextStroke?: string, fontWeight?: string }}
 */
export function getTextStyleWithOutline(hasBackgroundImage, backgroundColor) {
  return getTextStyle(hasBackgroundImage, backgroundColor);
}
