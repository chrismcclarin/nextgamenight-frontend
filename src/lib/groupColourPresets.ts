/**
 * The eight group colour presets — the two-value palette, as typed data.
 *
 * Phase 88.3.1, CONTEXT D-04: a group's stored `color_preset` is an ID, never a hex. The FE
 * resolves that id to a dark band, a light surface and a per-theme ink through THIS table. The
 * backend carries a copy of the eight ids AND their two GROUNDS (`utils/groupColourPresets.js`,
 * plan 88.3.1-02): the ids for the settings validator's allowlist, the grounds for the one-time
 * remap's computed nearest-preset arm (`utils/groupColourRemap.js`, which reads `preset[band]`).
 * The four INK values are frontend-only. No colour value crosses the wire in either direction —
 * that part of the contract is intact; a group stores an ID.
 *
 * **CORRECTED 2026-08-30 (code review #25): this header used to say the backend copy was
 * "id-only". It is not, and the difference is load-bearing** — D-01's decisive argument, recorded
 * in three separate markers, is that "a palette re-tune after ui-phase is an FE-only edit with no
 * data migration". That holds for the INKS. It does NOT hold for the grounds: re-tune a ground
 * here after the remap has run and the backend copy silently becomes historical data describing
 * the palette the remap was computed against, while `tests/unit/groupColourPresets.test.js` stays
 * green because it is pinned to the UI-SPEC rather than to this module.
 *
 * `.ts`, not `.js`, on purpose: the `as const` below is what makes `PresetId` a union of the
 * eight literal ids, so a mistyped id in a consumer is a compile error instead of a silent
 * uncoloured card.
 */

/*
 * DECISION Phase 88.3.1 (D-07): these thirty-two ground/ink values and the sixteen muted rungs
 * derived from them are "Set B-rev3" — the palette the owner picked across three rounds of
 * rendered 375px mockups. This block records HOW they were derived, so they read as
 * reproducible data rather than as hand-picked hexes, in the same style as the availability
 * wash ramp's recipe at `availabilityColor.ts:135-157`.
 *
 * WHY THE PALETTE WAS REPLACED AT ALL. The eight near-black presets it supersedes measure
 * ΔE2000 **1.62** apart in light mode — sub-JND. That is why the owner could not tell swatches
 * 1/2/3 or 7/8 apart on his phone (88.3 UAT test 9a, the finding that created this phase). This
 * set measures **10.48** light / **10.32** dark: 6.5x and 2.2x better, and more than 2x SPEC
 * Req 2's floor of 5.
 *
 * DERIVATION. Eight OKLCH hue anchors spaced 38-51 degrees apart, then per-preset lightness and
 * chroma hand-tuned WITHIN an envelope rather than held uniform. Uniform is not achievable:
 * sRGB caps pale Red/Blue/Violet at C ~ 0.050-0.052 on this light band while Green/Teal/Amber
 * have room to 0.14+. And a lightness differential inside a confusable pair is the strongest
 * perceptual lever available — which is why dark Green sits at L* 24.6 while dark Teal sits at
 * 19.4, and dark Violet at 19.1 while dark Blue sits at 15.4. Peers do the same (Radix's
 * per-hue steps do not share an L*; Google Calendar's classic palette spans L* 47.6-89.5).
 *
 * BAND EXCEPTION 1 — dark `green` sits at CIE L* **24.6**, ABOVE SPEC Req 1's "L* ~ 12-20"
 * target. Owner-directed (UI-SPEC 2.1 row 5, "make the green a little brighter"), because Green
 * and Teal read too close on swatches and tiles. It had to cross Teal (L* 19.4) rather than
 * stop short of it: measured Green/Teal ΔE2000 as Green climbs is 19.88 at L* 15.7, 19.54 at
 * 20.3, 20.48 at 22.7, 21.24 at 24.6 — the halfway house is the worst point on the curve.
 * THE NUMBER THAT CAPS IT: the dark `content-muted` pole `#b8a898` (`globals.css:1547`)
 * measures 5.86:1 on green at L* 19, **4.89:1 at 24.6**, and **4.39:1 — a SPEC Req 3 FAIL — at
 * 27.7**. Nobody may brighten green further without re-running UI-SPEC 2.4.
 *
 * BAND EXCEPTION 2 — the light band is **88.2**-88.6, about 1 L* BELOW the page `#e8e0d8`
 * (L* 89.6) and below Req 1's "L* ~ 90-96" target. Owner-directed (UI-SPEC 2.1 row 7, CONTEXT
 * D-07 round 3): shown both bands rendered side by side at identical hues and chroma targets he
 * picked the lower one — "the right side has more definition around the background". The
 * winning axis was CHROMA (+21-25% on Red, Blue and Violet), not lightness; page separation
 * measured 1.03-1.04:1 either way, i.e. nil in both. THE MIRROR CAP: the light `content-muted`
 * pole `#6b5a4c` (`globals.css:940`) measures **4.86:1** on `orange`, and the measured floor is
 * about L* 85.5 (88.4 -> 4.86, 87.0 -> 4.69, 86.0 -> 4.56, 85.5 -> 4.49 FAIL).
 * **Do not "restore" the light band to >= 89.6.** The two caps pull in OPPOSITE directions: any
 * future lift of the dark green band eats 4.89, any future lowering of the light band eats
 * 4.86. Re-run UI-SPEC 2.4 in full before touching either.
 *
 * ORDER IS LOAD-BEARING. It is the picker's `grid-cols-4` reading order (row 1 Red / Orange /
 * Amber / Green, row 2 Teal / Blue / Violet / Rose — the hue wheel, warm to cool) AND the
 * tie-break order for the migration's nearest-preset rule (CONTEXT D-02, plan 88.3.1-05).
 * Re-sorting this array silently re-decides a database migration.
 *
 * THE INKS ARE NEVER PERSISTED AND NEVER SENT (UI-SPEC 4.1). They resolve on the FE from the
 * id, exactly like the grounds. Gate B test 1's "the tint never reaches the save path" extends
 * to `inkDark` / `inkLight` / `mutedDark` / `mutedLight` verbatim.
 *
 * REJECTED, and named so nobody re-opens them by accident:
 *   (1) ONE UNIFORM `OKLCH(L, C)` PER THEME. It clamps every hue to the worst hue's gamut
 *       ceiling and re-creates Set A's grey Red/Blue/Violet — the look the owner rejected on
 *       sight.
 *   (2) A SINGLE HEX PER PRESET PLUS A COMPUTED TINT. Withdrawn ruling 4a, measured dead in
 *       `.planning/research/LIGHT-MODE-USER-COLOUR-TINTS-SURVEY-2026-08-27.md`: the best-case
 *       OKLCH derivation fuses Indigo/Storm to ΔE **0.00**.
 *   (3) SET A. It had the HIGHER headline ΔE but lower chroma (0.028-0.051, with Red/Blue/Violet
 *       clipped toward tinted grey) and the owner rejected it by eye. The lesson, recorded
 *       because it is the counter-intuitive one: min/median ΔE did NOT discriminate A from B.
 *       The metric is a floor, not a ranking — clearing it is necessary, never sufficient.
 *
 * Changing this is a decision, not a cleanup.
 */

/*
 * DECISION Phase 88.3.1 (M24, AMENDMENT A — owner-ruled 2026-08-29): the 85% muted rung is a
 * STORED LITERAL on each row, not a render-time computation.
 *
 * DERIVATION, so these sixteen values are reproducible and not hand-picked:
 *   mutedDark  = blend(inkDark,  0.85, dark)
 *   mutedLight = blend(inkLight, 0.85, light)
 * using `wcag.ts:275`'s exact semantics — per-channel `bg + (fg - bg) * alpha`, rounded, source
 * -over in sRGB space. `groupColourPresets.test.ts` RE-DERIVES all sixteen with that same
 * `blend` and asserts byte equality, which is what stops the literal and its recipe silently
 * diverging now that nothing calls `blend` at runtime.
 *
 * WHY A LITERAL RATHER THAN A CALL. Plan 88.3.1-06 was going to compute the rung at render time
 * with `blend` from `./wcag` inside `colorUtils.js`, which SEVEN client components import. That
 * would have made `wcag.ts` a production dependency for the first time — today all thirteen
 * `blend(` call sites and all four real imports of `wcag.ts` are tests or e2e support. The rung
 * is a pure function of (preset, theme), so there are exactly SIXTEEN possible values, all
 * knowable at module load. The boundary is now enforced mechanically by
 * `groupColourRendering.test.ts` test 25 (AMENDMENT Y).
 *
 * Measured on their own grounds: **6.1946-6.2835** (dark) and **5.5239-5.6844** (light). The
 * worst rung is violet light at **5.5239**, which reproduces UI-SPEC 2.6's published 5.52
 * exactly — that reproduction is the transcription check.
 *
 * THIS DOES NOT RE-OPEN `DECISION Phase 88.3-16` at `CalendarMonthView.js:52-60`. That marker
 * rejects in-component `useMemo` / `useCallback` as an unmeasured performance claim. A table
 * literal is a different mechanism, adopted for a different reason (bundle boundary, not render
 * cost). The two are not in tension.
 *
 * REJECTED: computing the rung with `blend` at render time (ships ~110 lines of WCAG maths to
 * seven client bundles); a ninth hand-tuned hex per preset (unreproducible, and the byte-equality
 * test above could not exist). Changing this is a decision, not a cleanup.
 */
export const GROUP_COLOUR_PRESETS = [
  {
    name: 'red',
    label: 'Red',
    dark: '#52151c',
    light: '#ffd3d4',
    inkDark: '#feaeaf',
    inkLight: '#6b252c',
    mutedDark: '#e49799',
    mutedLight: '#813f45',
  },
  {
    name: 'orange',
    label: 'Orange',
    dark: '#422200',
    light: '#ffd6b1',
    inkDark: '#f3b57f',
    inkLight: '#5e3200',
    mutedDark: '#d89f6c',
    mutedLight: '#764b1b',
  },
  {
    name: 'amber',
    label: 'Amber',
    dark: '#322b00',
    light: '#e7e0aa',
    inkDark: '#d1c577',
    inkLight: '#463e01',
    mutedDark: '#b9ae65',
    mutedLight: '#5e561a',
  },
  {
    name: 'green',
    label: 'Green',
    dark: '#004511',
    light: '#bde9c2',
    inkDark: '#a9e9b1',
    inkLight: '#024819',
    mutedDark: '#90d099',
    mutedLight: '#1e6032',
  },
  {
    name: 'teal',
    label: 'Teal',
    dark: '#003538',
    light: '#94edf0',
    inkDark: '#6cd9dd',
    inkLight: '#014548',
    mutedDark: '#5cc0c4',
    mutedLight: '#175e61',
  },
  {
    name: 'blue',
    label: 'Blue',
    dark: '#00274d',
    light: '#c4e1ff',
    inkDark: '#8ac2fb',
    inkLight: '#033f6f',
    mutedDark: '#75abe1',
    mutedLight: '#205785',
  },
  {
    name: 'violet',
    label: 'Violet',
    dark: '#33255a',
    light: '#dfd9ff',
    inkDark: '#cbc0ff',
    inkLight: '#42336f',
    mutedDark: '#b4a9e6',
    mutedLight: '#5a4c85',
  },
  {
    name: 'rose',
    label: 'Rose',
    dark: '#3e133c',
    light: '#fdd1f8',
    inkDark: '#e4a8de',
    inkLight: '#5d2a5a',
    mutedDark: '#cb92c6',
    mutedLight: '#754372',
  },
] as const;

/** One row of the table above. */
export type GroupColourPreset = (typeof GROUP_COLOUR_PRESETS)[number];

/**
 * The eight stored ids, as a union.
 *
 * This is the point of the `as const` above: `presetByName('blurple')` is a COMPILE error, not
 * a runtime `undefined` that renders a silently uncoloured card.
 */
export type PresetId = GroupColourPreset['name'];

/**
 * The stored ids in table order — DERIVED, never retyped.
 *
 * CONTEXT D-04 names this as the export tests use and as the source the backend's
 * `GROUP_COLOUR_PRESET_IDS` is copied from. Deriving it is what makes the two impossible to
 * disagree about ordering, which the migration's tie-break rule depends on.
 */
export const PRESET_IDS: readonly PresetId[] = GROUP_COLOUR_PRESETS.map((preset) => preset.name);

/**
 * One lookup structure, built once — not a `.find` repeated at every call site.
 *
 * Project tenet: duplication is never a peer option. `resolveGroupGround` (plan 88.3.1-06) is
 * the only caller today; the picker and the migration read the array directly.
 */
const BY_NAME: ReadonlyMap<string, GroupColourPreset> = new Map(
  GROUP_COLOUR_PRESETS.map((preset) => [preset.name, preset]),
);

/**
 * Resolve a stored preset id to its row.
 *
 * The parameter is narrowed to `PresetId` so a typo is caught at compile time. The return type
 * is still `| undefined` and that is not redundant: the real callers are `.js` files
 * (`checkJs` is `false`), so an unvalidated value out of the database can and does reach here.
 * A miss is the caller's cue to fall back to the legacy hex path, never to render half a card.
 */
export function presetByName(name: PresetId): GroupColourPreset | undefined {
  return BY_NAME.get(name);
}
