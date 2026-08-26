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
 *
 * ——— AMENDED Phase 88.3 (D-09), original reasoning above KEPT AS HISTORY:
 * THE PROPHECY IS FULFILLED — the two lighter tiers are LIVE, and not for the
 * reason predicted. No light preset shipped; instead every group colour is now
 * RENDERED in light mode as a light tint of itself
 * (`lightTintGroupBackgroundColor` below, owner ruling t = 0.70, 2026-08-25).
 * All eight tints measure W3C brightness 188-191, so `getTextStyle` takes its
 * `brightness > 180` branch and `getContrastColor` / `isDarkBackground` return
 * the dark pole on six rendering surfaces. That branch was unreachable before
 * this phase and is load-bearing now.
 *
 * NOTE THE MARGIN: 188-191 clears the 180 threshold by only ~8-11 points (it
 * was ~46-47 at the previously-ruled t = 0.87). `colorUtils.test.ts` therefore
 * asserts `getBrightness(tint(preset)) > 180` per preset rather than inferring
 * it from the L* floor.
 *
 * So: do NOT delete these tiers, and do NOT "simplify" them now that they run
 * — collapsing the algorithm now would break the light-mode rendering of every
 * coloured group. Still a decision, not a cleanup.
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
/*
 * DECISION Phase 88.3 (R2-6): this pole is `#374151`, chosen OVER the `#6b7280`
 * it carried until this phase.
 *
 * WHY. Phase 88.3 renders a group's stored colour as a light tint of itself in
 * light mode (`lightTintGroupBackgroundColor`, t = 0.70). Measured against the
 * eight resulting tints, `#6b7280` scores 2.5-2.65:1 — it FAILS 4.5:1 on every
 * one of them, i.e. the muted line would be unreadable on every coloured card,
 * tile and row in light mode. `#374151` (already this file's
 * `SUBTITLE_VERY_LIGHT_BG` pole) measures 5.35-5.65:1 and passes with margin.
 *
 * REJECTED: keeping `#6b7280` as the status quo, which was only ever legible
 * because the ground it was drawn on used to be the WHITE card, not a tint.
 * Pinned per preset in `colorUtils.test.ts`. Reverting it is a decision, not a
 * cleanup.
 */
const TEXT_MUTED_ON_LIGHT_BG = '#374151'; // Muted body text on a light ground

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
 * The dark-ground twin of the pole above, added by Phase 88.3 (R2-6) because
 * the theme fork needs BOTH halves. `SUBTEXT_MUTED_ON_LIGHT` used to be painted
 * unconditionally on past-date calendar tiles in both themes; once it moved to
 * `#374151` that reading became dark-slate-on-navy (~1.4:1) in dark mode, so
 * the dark half needs its own value. 70% white keeps the "past" dimming legible
 * against every shipped preset (>= 7:1) — same idiom as the 90% white the row
 * subtitles already use, one step dimmer.
 */
export const SUBTEXT_MUTED_ON_DARK = 'rgba(255, 255, 255, 0.7)';

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

/**
 * The RENDERED ground for a stored group colour in LIGHT mode: a per-channel
 * linear mix of the stored hex toward white — `round(c + (255 - c) * t)`. Same
 * arithmetic shape as the ratified `-subtle` tint rule (i) at
 * `globals.css:713-716` (`round((1-t)*ground + t*hue)`), with white as the
 * target, so this file's formula and its rounding already have a precedent.
 *
 * Returns `null` when the group has no colour of its own, and ALSO when the
 * stored value cannot be parsed as a 6-digit hex. Never throws — the totality
 * contract `getBrightness` already sets in this file (it returns 255 rather
 * than blowing up), because these values come off an API response and a throw
 * here would take out the render of every group card.
 *
 * Callers MUST omit both custom properties entirely when this returns `null`,
 * and MUST gate the STORED value on this result too (`const ground = tinted ?
 * stored : null`) — a hex that fails to tint must withhold BOTH grounds
 * together, never just the light one. An inline background beats the themed
 * `bg-surface-*` class, and that override is the exact mechanism of the D-28
 * white-card defect.
 *
 * TWO RULES THE CALLERS DEPEND ON:
 *  1. Ask `isUnsetBackgroundColor` about the **stored** hex; ask
 *     `isDarkBackground` / `getTextStyle` / `getEventTileTextColor` about the
 *     **rendered** ground. A legacy `#fefefe` is a real colour that tints to
 *     exactly `#ffffff`, so re-asking "is unset?" about the rendered value
 *     would silently strip that group's ground (Pitfall 8).
 *  2. This is a RENDERING transform. It must NEVER reach a save payload — see
 *     the marker at `GroupSettings.js`'s form-state seed.
 *
 * DECISION Phase 88.3 (D-09): a group's colour renders as a LIGHT TINT of
 * itself in light mode and as the stored hex in dark, chosen OVER two named
 * alternatives.
 *
 * WHY. The owner's principle is "light mode gets light colours — no dark bands
 * in light mode ... if they choose dark blue in dark mode, it should be light
 * blue in light mode". The stored hex stays the group's IDENTITY; this is its
 * RENDERING. The DB column, the backend `^#[0-9A-Fa-f]{6}$` validator and the
 * raw preset array (`GroupSettings.js`, `DECISION 88-22 D-27`) are untouched.
 *
 * REJECTED (1): storing the tint instead of computing it. That destroys the
 * identity colour irreversibly — the original hex is not recoverable from the
 * tint — and is the exact failure mode `GroupSettings.js`'s seed marker guards.
 * REJECTED (2): a per-theme branch INSIDE this function. It deliberately takes
 * no theme argument; the theme fork belongs in the CSS cascade, where the
 * shipped `DECISION Phase 88.1 (plan 15, Req 8)` at `EventScheduler.tsx` put it
 * — no `useTheme` read, no hydration fork, no theme-flash window.
 *
 * MEASURED BASIS (t = 0.70, owner ruling 2026-08-25, plan adversarial review
 * round 2): all 8 presets land at L* 75.7 (worst case, Wine) or better, with
 * W3C brightness 188-191 — inside `getTextStyle`'s `brightness > 180` tier but
 * with a margin of only ~8-11 points, down from ~46-47 at the previously-ruled
 * 0.87. 0.87 was rejected by the owner because the eight presets had converged
 * to pairwise 1.01:1 and were no longer told apart.
 *
 * Changing `t`, or reverting to the stored hex in light mode, is a decision,
 * not a cleanup.
 *
 * @param {string|null|undefined} color - STORED background colour
 * @param {number} [t=0.70] - mix toward white, clamped to [0, 1]
 * @returns {string|null} `#rrggbb`, or null to defer to the themed surface
 */
export function lightTintGroupBackgroundColor(color, t = 0.70) {
  if (isUnsetBackgroundColor(color)) return null;
  if (typeof color !== 'string') return null;

  const hex = color.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;

  const amount = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.70;

  let out = '#';
  for (let i = 0; i < 6; i += 2) {
    const channel = parseInt(hex.slice(i, i + 2), 16);
    out += Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

/**
 * Hand a two-theme text treatment to the CSS cascade as custom properties.
 *
 * The companion to `lightTintGroupBackgroundColor`: the ground forks in CSS, so
 * the text drawn on it must fork in CSS too. An INLINE `color` / `textShadow` /
 * `WebkitTextStroke` declaration beats any `dark:` class (the plan-07 inert-
 * override trap), so a caller must delete those keys and carry
 *
 *   [color:var(--t-color-l)] dark:[color:var(--t-color)]
 *   [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)]
 *   [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]
 *
 * on the className instead. `fontWeight` is theme-independent and stays a plain
 * inline property.
 *
 * @param {{color?: string, textShadow?: string, WebkitTextStroke?: string, fontWeight?: string}} dark
 *        the treatment computed against the STORED hex (what dark mode paints)
 * @param {{color?: string, textShadow?: string, WebkitTextStroke?: string, fontWeight?: string}} light
 *        the treatment computed against the RENDERED tint (what light mode paints)
 * @returns {Record<string, string>} the six `--t-*` properties, plus fontWeight
 */
export function themedTextStyleVars(dark, light) {
  return {
    '--t-color': dark.color || 'inherit',
    '--t-color-l': light.color || 'inherit',
    '--t-shadow': dark.textShadow || 'none',
    '--t-shadow-l': light.textShadow || 'none',
    '--t-stroke': dark.WebkitTextStroke || 'none',
    '--t-stroke-l': light.WebkitTextStroke || 'none',
    ...(dark.fontWeight ? { fontWeight: dark.fontWeight } : {}),
  };
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
