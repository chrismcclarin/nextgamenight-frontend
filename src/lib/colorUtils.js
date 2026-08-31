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

import { logger } from '@/lib/logger';
import { presetByName } from './groupColourPresets';

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
 *
 * ——— AMENDED Phase 88.3.1 (UI-SPEC 2.4), both texts above KEPT AS HISTORY:
 * The computed tint is no longer how a preset renders. The eight presets are
 * now a TWO-VALUE table (`groupColourPresets.ts`) — a hand-tuned dark band and
 * a hand-tuned light surface per preset — so the grounds `getTextStyle` sees
 * for a preset group are table literals, not arithmetic.
 *
 * WHAT THAT DID TO THE TIERS. Presets now land at W3C brightness **211-227**
 * (light surfaces) and **32-47** (dark bands). The `> 180` tier and the `else`
 * tier are therefore both LIVE with LARGE margin — 31-47 points and 81-96
 * points — where 88.3's tints cleared 180 by only 8-11. The pin in
 * `colorUtils.test.ts` moves with them: `getBrightness(light) > 180` AND
 * `getBrightness(dark) <= 128`, per preset (UI-SPEC 10.1 test 11).
 *
 * THE MIDDLE TIER (`128 < brightness <= 180`, poles `#1f2937` + `#4b5563`) is
 * now UNREACHABLE FROM THE PRESET TABLE — and it survives for a DIFFERENT
 * reason than D-29 predicted. It is the tier a stored LEGACY or CUSTOM hex
 * falls into through the `lightTintGroupBackgroundColor(..., 0.70)`
 * compatibility path (UI-SPEC 3.2), which is the live path for every coloured
 * group in production until plan 88.3.1-05's remap runs, and permanently for
 * any non-preset hex. KEEP ALL THREE TIERS. Deleting them is still a decision,
 * not a cleanup.
 *
 * The tinted CARD ink added by this phase does NOT go through these tiers at
 * all — it is selected per preset per theme by the CSS fork (`groupInkVars`
 * below). These tiers keep serving the tile poles, the fallback path and the
 * background-image path, all of which are still live.
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
 * against every shipped preset (~~>= 7:1~~ — see the amendment) — same idiom as
 * the 90% white the row subtitles already use, one step dimmer.
 *
 * ——— AMENDED Phase 88.3.1 (plan 10). The struck ">= 7:1" was MEASURED and true
 * on the eight t = 0.70 tints Phase 88.3 shipped; it expired with the palette,
 * and this is the number, not the claim, that moved. Re-measured on the eight
 * bands in `groupColourPresets.ts`, this pole composited over each dark band:
 * **6.33 - 8.10:1**. The 6.33 is `green`, whose dark band sits at CIE L* 24.6 by
 * owner direction (BAND EXCEPTION 1 — "make the green a little brighter") rather
 * than at the 12-20 target, so it reflects more of the 70% white back.
 *
 * NOT A DEFECT and NOT a reason to change the alpha: 6.33:1 clears WCAG AA
 * (4.5:1) with 41% of margin on text that is deliberately DIMMED to read as
 * past. What it does mean is that `green` is now the binding row on a FOURTH
 * reading — `groupColourPresets.ts`'s palette marker already forbids brightening
 * it further without re-running UI-SPEC §2.4, and this is one more reason why.
 * REJECTED — raising the alpha to restore 7:1 across the set: it would dim the
 * "past" affordance less on seven bands to fix a number on one, and 7:1 was
 * never a floor here, only a measurement. A decision, not a cleanup.
 * The same correction is applied at the consuming site
 * (`CalendarMonthView.js`, plan 09) and in UI-SPEC §3.5.
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

/** A storable legacy colour: exactly six hex digits. The backend enforces the
 *  same shape (`middleware/validators.js`), and this is the FE half of it. */
const STORABLE_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * The value that may be written to `Groups.background_color`, or `null`.
 *
 * DECISION Phase 88.3.1 (code review #8/#12/#13/#15): THE SAVE PATH FILTERS,
 * IT DOES NOT FORWARD. `GroupSettings.js`'s picker state holds whatever the
 * group had stored, and three separate findings showed that forwarding it
 * verbatim is wrong in three different ways:
 *
 *  - **#8** a stored `#ffffff` (the model default — `models/Group.js` still
 *    defaults the column to white) seeded the picker and was re-persisted on
 *    every save. That is the mechanism that manufactured the D-28 white cards.
 *    `isUnsetBackgroundColor` already knew white is "unset"; the save path had
 *    stopped asking it.
 *  - **#12** a non-canonical preset id (`'Blue'`) RENDERS fine, because
 *    `resolveGroupGround` lower-cases before the lookup — but it is not in
 *    `PRESET_IDS`, so it used to be forwarded into `background_color`, where the
 *    backend's six-hex-digit rule 400s it. The group's settings modal becomes
 *    permanently unsaveable, for a value the renderer deliberately tolerates.
 *  - **#15** the same door, opened by poly-repo skew instead of by bad data: a
 *    ninth preset added BE-first is stored, the older FE does not know the id,
 *    forwards it, and 400s — so skew degraded from "renders uncoloured" (the
 *    graceful outcome the M23 marker describes) to "no group setting can be
 *    saved at all", which is the opposite.
 *
 * REJECTED: a hex regex inline in `handleSave`. Keeping it here means the save
 * path names no pattern and no colour, which is what `groupColourRendering.test.ts`
 * test 1(b) enforces — and it gives `resolveGroupBackgroundColor` a production
 * caller again (#13), instead of leaving it a zero-caller export kept alive by
 * its own tests.
 *
 * @param {string|null|undefined} value - the picker's current form state
 * @returns {string|null} a six-digit hex safe to persist, or null
 */
export function storableGroupHex(value) {
  const resolved = resolveGroupBackgroundColor(
    typeof value === 'string' ? value.trim() : value,
  );
  return resolved && STORABLE_HEX_PATTERN.test(resolved) ? resolved : null;
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
 * ——— AMENDED Phase 88.3.1 (D-04 / UI-SPEC 3.2), original reasoning above KEPT
 * AS HISTORY:
 * This function is UNCHANGED and is still the right function — but its SCOPE
 * has narrowed. It is no longer the preset path. A group's stored value is now
 * a PRESET ID (`color_preset`), and an id resolves through
 * `GROUP_COLOUR_PRESETS` to a hand-tuned light surface, so nothing is computed
 * for it. This function is reached ONLY when the stored value is a non-preset
 * `#rrggbb` — a legacy row before plan 88.3.1-05's migration runs, or a custom
 * hex thereafter. That is the COMPATIBILITY path, and it is the LIVE path for
 * every coloured group in production between the FE PR and BE PR-2.
 *
 * BOTH NAMED REJECTIONS ABOVE STAY BINDING. Storing the tint instead of
 * computing it is still forbidden (it destroys the identity colour; Gate B
 * test 1, "the tint never reaches the save path" — now extended verbatim to
 * `inkDark` / `inkLight` / `mutedDark` / `mutedLight`). A per-theme branch
 * INSIDE this function is still forbidden; the theme fork still lives in the
 * CSS cascade, which is why `resolveGroupGround` below also takes no theme
 * argument.
 *
 * A LEGACY HEX HAS NO TINTED INK. `resolveGroupGround` returns `inkDark` and
 * `inkLight` as `null` on this path and every consumer falls back to the plain
 * poles of UI-SPEC 2.4 — which is exactly why those poles stay exported and
 * stay measured, and why `colorUtils.test.ts` keeps the eight legacy t = 0.70
 * tints pinned alongside the new light surfaces rather than replacing them.
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
 * The one accessor for a group's stored colour.
 *
 * A group carries the new preset id in `color_preset` and the legacy hex in
 * `background_color`; during the expand window (FE PR shipped, BE PR-2's remap
 * not yet run) BOTH columns are populated across the estate. Every render site
 * and the settings seed ask this ONE function which of the two is authoritative,
 * so "which column wins" is decided in a single place rather than seven.
 *
 * TWO OPERATORS THAT LOOK LIKE THE SAME JOB AND ARE NOT:
 *  - `??` on the COLUMN choice, deliberately not `||`. **CORRECTED 2026-08-30
 *    (code review findings #4/#18): the reason this marker used to give was
 *    stale.** It claimed "the backend validator (plan 88.3.1-02) still accepts
 *    `''` and whitespace" — it does not. The validator shipped in that same plan
 *    collapses `''` and whitespace-only to `null` in a `customSanitizer` BEFORE
 *    the `.custom()` arm sees it (`middleware/validators.js:136-142`), pinned by
 *    `tests/routes/groups.test.js`. So an empty `color_preset` is not an
 *    API-reachable state at all.
 *    `??` is still correct, for the reason that actually holds: it keeps "column
 *    present but explicitly null" distinguishable from "column absent", and it is
 *    defence-in-depth against the one writer the validator does not cover — a
 *    hand-written DB row or a future writer that bypasses the API. The `''` and
 *    whitespace cases in `colorUtils.test.ts:402-412` remain the right pin.
 *  - `|| null` on the RESULT, which normalises a trimmed-empty value to `null`
 *    so `resolveGroupGround`'s unset-first rule fires instead of a `''` reaching
 *    the preset lookup.
 *
 * @param {{color_preset?: string|null, background_color?: string|null}|null|undefined} group
 * @returns {string|null} the authoritative stored value, trimmed, or null
 */
export function storedGroupColour(group) {
  const stored = group?.color_preset ?? group?.background_color;
  return (typeof stored === 'string' ? stored.trim() : stored) || null;
}

/**
 * Turn a STORED group colour into the pair of grounds and the pair of inks the
 * CSS cascade needs — or `null` when the group has no colour of its own.
 *
 * This is THE resolver. Six render sites plus the settings seed used to each do
 * their own `resolveGroupBackgroundColor` + `lightTintGroupBackgroundColor` pair
 * and hand both to the cascade; they all call this instead.
 *
 * TWO RULES THE CALLERS DEPEND ON — restated here because this is the entry
 * point callers now land on, and the rules must be readable where they land:
 *  1. `isUnsetBackgroundColor` is asked of the **stored** value, and it is this
 *     function's FIRST line. `isDarkBackground` / `getTextStyle` /
 *     `getEventTileTextColor` are asked of the **rendered** ground. A legacy
 *     `#fefefe` is a real colour that tints to exactly `#ffffff`, so re-asking
 *     "is unset?" of the rendered value would silently strip that group's
 *     ground (Pitfall 8).
 *  2. This is a RENDERING transform. Nothing it returns — neither ground,
 *     neither ink — may ever reach a save payload. See the marker at
 *     `GroupSettings.js`'s form-state seed, which is a security control.
 *
 * BOTH GROUNDS OR NEITHER. The return is `null` or an object with `dark` AND
 * `light` both populated — never half. That was T-88.3-43's hand-written
 * `const ground = tinted ? stored : null` gate at six sites; here it is a
 * property of the return type.
 *
 * DECISION Phase 88.3.1 (D-04): ONE resolver, six consumers, returning PLAIN
 * VALUES.
 *
 * REJECTED (a): a per-consumer preset lookup. Rejected by project tenet, not on
 * taste — the owner's rule is direct: "writing a function 6 times is adding tech
 * debt... turning repeated code lines into modular functions to call is part of
 * what we are doing".
 * REJECTED (b): returning ready `--group-*` custom-property objects (CONTEXT
 * D-04 REJECTED (C)). Consumers would spread it, the literal ground key would
 * vanish from every style expression, and `groupColourRendering.test.ts`
 * test 9's "the pair is always emitted together" assertion would pass
 * vacuously. `groupInkVars` below is the only thing in this file that emits
 * custom properties.
 * REJECTED (c): a `theme` parameter or a `useTheme` read. 88.3 D-09
 * REJECTED (2), still binding — the theme fork lives in the CSS cascade, so
 * there is no hydration fork and no theme-flash window.
 *
 * Changing this is a decision, not a cleanup.
 *
 * @param {string|null|undefined} stored - the STORED value (`storedGroupColour`)
 * @returns {{preset: string|null, dark: string, light: string, inkDark: string|null, inkLight: string|null}|null}
 */
/**
 * Distinct unrecognised stored values already reported this page load (CLUSTER A).
 * Module scope on purpose: the lifetime that matters is the page, not the render.
 * Not exported and not resettable — a reset hook would be API surface that only
 * tests want. The cost is real and is paid in the test file instead: because the
 * Set outlives each test, any spec asserting ON the warn must use a value no
 * other spec in the module has already resolved. `colorUtils.test.ts:486` proved
 * that the hard way — it iterates `'sunset'` for an unrelated assertion, which
 * silently consumed the one warn the M23 spec was asserting. Those specs now use
 * dedicated `skew-preset-*` values and say so.
 */
const WARNED_UNKNOWN_STORED = new Set();

export function resolveGroupGround(stored) {
  if (isUnsetBackgroundColor(stored)) return null;

  // Trimmed and lower-cased: a stored id round-trips through a database, and a
  // case or whitespace difference must not silently demote a preset group to
  // the legacy arm.
  const preset = presetByName(stored.trim().toLowerCase());
  if (preset) {
    return {
      preset: preset.name,
      dark: preset.dark,
      light: preset.light,
      inkDark: preset.inkDark,
      inkLight: preset.inkLight,
    };
  }

  const light = lightTintGroupBackgroundColor(stored, 0.70);
  if (light === null) {
    /*
     * DECISION Phase 88.3.1 (M23): this warn fires on THIS arm only — a stored
     * value that is neither unset, nor a known preset id, nor a parseable hex —
     * and deliberately NOT on the legacy-hex arm below. The two arms are
     * separate on purpose; merging them is a decision, not a simplification.
     *
     * WHY THE SEPARATION IS THE LOAD-BEARING HALF. The legacy-hex arm is valid,
     * supported, and is the path EVERY coloured group in production renders
     * through for the entire window between the FE PR and BE PR-2. Warning on
     * it would flood Sentry for that whole window and train everyone to ignore
     * the signal — destroying the value of the one case that matters.
     *
     * WHY IT EXISTS AT ALL. Without it an unrecognised `color_preset` renders an
     * uncoloured card with no error, no log and no telemetry on either side of
     * the wire — indistinguishable from "the user chose no colour". The
     * realistic trigger is poly-repo deploy skew: FE ships on Vercel and BE on
     * Railway from separate repos, so a ninth preset added to BE first is
     * accepted and stored while the older FE renders every group using it
     * uncoloured.
     *
     * THIS IS THE SECOND LAYER. The primary guard is the cross-repo preset-id
     * contract test (plan 88.3.1-02), which is what makes an FE/BE divergence
     * impossible to SHIP. This catches drift arriving by a path no test models:
     * a hand-run migration, a rollback, a manual DB edit. The two layers fail
     * independently, which is the requirement.
     */
    /*
     * DECISION Phase 88.3.1 (code review, CLUSTER A — five lenses independently):
     * ONE EVENT PER DISTINCT BAD VALUE PER PAGE LOAD, not one per render.
     *
     * `logger.warn` is `Sentry.captureMessage` (`logger.ts:31-32`) — a real
     * quota-consuming event, not a console line. This function is a RENDER-path
     * resolver with seven production call sites, five of them inside per-item
     * loops (per group card, per calendar tile, per list row, per day-modal row,
     * per swatch x8), and `CalendarMonthView.js:52-89` deliberately refuses to
     * memoise its loop. Unthrottled, the marker's own named trigger — poly-repo
     * skew where BE accepts a ninth preset the FE has not shipped — makes one
     * affected group emit one Sentry event PER TILE PER PAINT, forever.
     *
     * That is precisely the flood the paragraph above rejects for the legacy
     * arm ("would flood Sentry for that whole window and train everyone to
     * ignore the signal"). The mitigation there bounded the ARM; this bounds the
     * RATE. The signal being preserved is per-VALUE, not per-render, so nothing
     * is lost: the first sighting of each distinct bad value still reports.
     *
     * REJECTED: dropping the warn (it is the only drift detector on this path),
     * and relying on Sentry's `dedupeIntegration` (it compares only against the
     * immediately preceding event, so any interleaved event resets it).
     */
    const key = String(stored).slice(0, 32);
    if (!WARNED_UNKNOWN_STORED.has(key)) {
      WARNED_UNKNOWN_STORED.add(key);
      logger.warn('unrecognised stored group colour', { stored: key });
    }
    return null;
  }

  /*
   * The legacy / custom-hex compatibility path (UI-SPEC 3.2). `dark` is
   * NORMALISED to `#rrggbb` rather than echoed raw: `lightTintGroupBackgroundColor`
   * deliberately tolerates a missing `#` and upper case, so echoing the raw
   * value could hand the cascade `1e1e2e` for the dark ground while the light
   * twin was a valid `#bcbcc0` — a half-rendered group, which is the one thing
   * this return type exists to make impossible.
   */
  const dark = `#${stored.trim().replace(/^#/, '').toLowerCase()}`;
  return { preset: null, dark, light, inkDark: null, inkLight: null };
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
 * on the className instead. `fontWeight` is DELIBERATELY not returned here: it
 * is theme-independent, and returning it would make this object unsafe to spread
 * onto a CONTAINER (custom properties inherit, `font-weight` inherits too — and
 * it would then bold every descendant, which the per-element treatments it
 * replaces never did). Callers apply `font-semibold` at the text element.
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
  };
}

/**
 * The ONE ink-resolving function: hand the cascade the group's text ink for a
 * resolved ground, choosing card ink versus tile ink by ARGUMENT.
 *
 * Returns `{}` — never a partial object — whenever there is no ink to hand
 * over, so a spread into a `style` prop emits nothing and whatever the consumer
 * already computed (its `themedTextStyleVars(getTextStyle(...))` output) stands
 * untouched.
 *
 * DECISION Phase 88.3.1 (D-04 / UI-SPEC 3.4): FOUR NEWLY-MINTED
 * `--group-ink*` custom properties, and card-vs-tile as a parameter.
 *
 * REJECTED: reusing `themedTextStyleVars`'s `--t-*` channel. The MECHANISM is
 * the load-bearing part, so the number is recorded: that channel is emitted at
 * SEVEN sites today, and at FIVE of them (`EventDayModal.js:289,:295`,
 * `CalendarListView.js:879,:883,:913`) the existing emission sits on a
 * DESCENDANT of the element these vars land on — a descendant redeclaration
 * wins, so the tinted ink would never reach the text. At `grouplist.js:337` the
 * two land in the SAME object literal, where plain spread order silently
 * decides and nothing specifies it. No test reads a computed style, so that
 * would have shipped green with wrong pixels. Minting is additive:
 * `themedTextStyleVars` is byte-untouched and its 7 sites keep working.
 *
 * REJECTED: replacing `themedTextStyleVars` at the four card sites and emitting
 * `--t-*` once at the row root. It deletes two live channels — `cardTextBold`
 * (`grouplist.js:316`, driving `font-semibold` at `:481`) and
 * `--t-weight`/`--t-weight-l` (`groupHomePage/page.js:403-406`, whose own
 * comment warns that `inherit` "would silently un-bold the uncoloured header")
 * — plus the shadow/stroke treatments `getTextStyle` computes for the
 * background-image path.
 *
 * REJECTED: a second `getCardTextStyle` beside `getTextStyle`. UI-SPEC 3.4 is
 * explicit — one function, one parameter, no second copy — and UI-SPEC 10.1
 * test 12 asserts exactly one ink-resolving implementation by source scan.
 * Project tenet: duplication is never a peer option.
 *
 * THE MUTED RUNG IS A TABLE LITERAL, NOT A RUNTIME `blend` (M24 / plan 03
 * AMENDMENT A). `mutedDark` / `mutedLight` are read from `groupColourPresets`,
 * which carries the derivation and a byte-equality test against `blend`. This
 * file must NOT import `./wcag`: seven client components import this module and
 * that would ship ~110 lines of WCAG maths to all of them for 16 values that
 * are known at module load. `groupColourRendering.test.ts` test 25 enforces the
 * boundary mechanically. This does NOT re-open `DECISION Phase 88.3-16`
 * (`CalendarMonthView.js:52-60`) — that marker rejects in-component `useMemo` /
 * `useCallback` as an unmeasured performance claim; a transcribed table literal
 * is a different mechanism adopted for a different reason (bundle boundary, not
 * render cost). The two are not in tension.
 *
 * Changing this is a decision, not a cleanup.
 *
 * @param {{preset: string|null, dark: string, light: string, inkDark: string|null, inkLight: string|null}|null} ground
 *        a `resolveGroupGround` result
 * @param {{surface: 'card'|'tile', hasBackgroundImage: boolean}} options
 *        `surface` picks the ink family; `hasBackgroundImage` is REQUIRED of
 *        every caller — see the image arm below
 * @returns {Record<string, string>} the four `--group-ink*` properties, or `{}`
 */
export function groupInkVars(ground, options) {
  const { surface, hasBackgroundImage } = options || {};

  if (!ground) return {};

  /*
   * DECISION Phase 88.3.1 (AMENDMENT 7): a group with a background IMAGE gets
   * NO group ink, chosen OVER emitting the preset's tinted ink over the photo.
   *
   * A group can carry a `color_preset` AND an uploaded `background_image_url`
   * at the same time. `getTextStyle(hasBgImage, ...)` already answers that
   * correctly — white text, dark stroke, heavy shadow — because a user's photo
   * is an unmeasurable ground. Returning `{}` here leaves that shipped,
   * owner-ruled treatment standing. Emitting `blue`'s `#033f6f` (a dark navy
   * solved for a PALE BLUE card) over an arbitrary photograph is the defect
   * this closes.
   *
   * Note this only became reachable BECAUSE the minting above is correct:
   * before it the two treatments collided on one channel and the descendant
   * won; after it they coexist, so the consumer must choose — and nothing told
   * it to.
   *
   * DO NOT re-implement the white/stroke/shadow treatment here. It exists in
   * `getTextStyle`, it is correct, and duplicating it is the exact tenet
   * violation this function was written against. Callers must pass the
   * VALIDATED image flag (the `safeBgImageStyle` result, wave-12 owner ruling
   * at `grouplist.js:276-280`), never the raw string, so an invalid or relative
   * URL (FSEC-03) does not trigger the white-text treatment.
   */
  if (hasBackgroundImage) return {};

  if (surface === 'tile') {
    /*
     * Plain ink on tiles — owner ruling, UI-SPEC 3.3: "when it's small like
     * that, you need the text to be more distinct." The ink fields are ignored
     * here whether or not they are present, which is why a legacy hex still
     * gets tile ink while it gets `{}` on a card.
     */
    return {
      '--group-ink': getEventTileTextColor(ground.dark),
      '--group-ink-l': getEventTileTextColor(ground.light),
      '--group-ink-muted': SUBTEXT_MUTED_ON_DARK,
      '--group-ink-muted-l': SUBTEXT_MUTED_ON_LIGHT,
    };
  }

  if (surface === 'card') {
    const preset = ground.preset ? presetByName(ground.preset) : undefined;
    /*
     * The legacy / custom-hex arm (AMENDMENT 3): return `{}`, do NOT re-derive.
     * `grouplist.js:311-314` and `groupHomePage/page.js:409-415` have already
     * computed `getTextStyle` / `getSubtitleStyle` against these same grounds
     * in the same render; re-deriving them here produces byte-identical values
     * at extra cost. `{}` leaves their existing output standing, which is both
     * cheaper and correct. This is the LIVE path for the entire FE-deployed
     * window — BE PR-2 merges last, so until the remap runs every production
     * group is a legacy hex. It is not an edge case.
     */
    if (!preset || !ground.inkDark || !ground.inkLight) return {};

    return {
      '--group-ink': ground.inkDark,
      '--group-ink-l': ground.inkLight,
      // READ from the table, never recomputed (M24) — see the marker above.
      '--group-ink-muted': preset.mutedDark,
      '--group-ink-muted-l': preset.mutedLight,
    };
  }

  // An unknown surface hands back nothing rather than guessing an ink: `{}` is
  // always the safe answer, because it leaves the consumer's existing treatment
  // in place.
  return {};
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
