/**
 * D-16's ink rule for the muted ground, in ONE place.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two suites talk about the same set of forbidden ink tokens from opposite ends:
 *
 *  - `src/app/tokenContrast.test.ts` test 49 MEASURES them — it is the ratio evidence that the
 *    pairings are below WCAG AA, and it is the reason the rule exists at all.
 *  - `src/app/groundInk.test.ts` ENFORCES them — the ground-aware source scan that proves the
 *    pairings have no consumers.
 *
 * Duplicating the literal list in both was REJECTED, and the consequence is recorded so nobody
 * re-proposes it: two copies are green on day one and diverge on the first edit, at which point
 * test 49's zero-consumer row DESCRIBES a different set than `groundInk.test.ts` ENFORCES — a
 * silent divergence between a measurement and its gate, on the only machine evidence this phase
 * has for WCAG 1.4.3 / D-16.
 *
 * `src/test-utils/sourceScan.ts` is deliberately NOT the home. Owner ruling AC-12 (2026-09-09)
 * holds that module to one new capability this phase, and 88.6-09 has already spent its single
 * flagged amendment on RELOCATING `readOpeningTag` — a move that removes a duplicate. Spending
 * it again on a constant that has a legal home of its own would re-open AC-12 for no benefit.
 *
 * ENUMERATION BEHAVIOUR, CHECKED BEFORE THE NAME WAS COMMITTED
 * ------------------------------------------------------------
 * `sourceFiles` excludes a file only when its name carries a literal `.test.` or `.spec.`
 * segment (`sourceScan.ts:209`), and vitest collects a file as a suite only when it matches
 * `src/**` + `*.{test,spec}.{ts,tsx}` (`vitest.config.mts:67`). `inkRules.ts` matches NEITHER, so
 * it is enumerated as ordinary source by every scan suite in this phase while never being run as
 * one. That was verified rather than assumed: the full suite was run after this file landed and
 * no suite gained a phantom hit from the token literals below. If one ever does, the fix is to
 * rename this module to a form the `sourceFiles` filter excludes WITHOUT vitest collecting it
 * (for example `inkRules.spec.data.ts`), not to obfuscate the literals — a constant that cannot
 * be grepped for its own token is a constant the next reader will not find.
 *
 * DECISION Phase 88.6-09 (D-16): one named non-test module, imported by both suites, chosen OVER
 * (a) a literal copy in each suite (the divergence above) and OVER (b) an export on
 * `sourceScan.ts` (AC-12). Inlining either copy back is a decision, not a cleanup.
 */

/** The ground D-16 is about. `bg-surface-muted` resolves to `--color-bg-muted` (warm-250). */
export const MUTED_GROUND_CLASS = 'bg-surface-muted';

/** The CSS custom property `MUTED_GROUND_CLASS` paints. */
export const MUTED_GROUND_TOKEN = '--color-bg-muted';

/**
 * The FORBIDDEN set: ink that measures below the WCAG 1.4.3 AA floor of 4.5:1 on the muted fill.
 *
 * `cssVar` is the LEAF custom property each utility class resolves to. The chain is
 * `text-content-muted` -> `--color-content-muted` -> `--color-text-muted` (`globals.css:414`),
 * and `text-content-link` -> `--color-content-link` -> `--color-text-link` (`globals.css:416`);
 * the leaf is named here because that is the level `tokenContrast.test.ts`'s `resolve` measures.
 *
 * `ratio` is the value MEASURED on light `--color-bg-muted` (warm-250 #dbd1c7) and is carried
 * for prose only — test 49 re-derives every one of these from the stylesheet rather than
 * trusting the number, so a token re-point reds instead of going stale here.
 */
export const FORBIDDEN_INK_ON_MUTED = [
  { utility: 'text-content-muted', cssVar: '--color-text-muted', ratio: 4.3725 },
  { utility: 'text-content-link', cssVar: '--color-text-link', ratio: 3.9909 },
] as const;

/** The same set as a membership test, for the source scan. */
export const FORBIDDEN_INK_CLASSES: ReadonlySet<string> = new Set(
  FORBIDDEN_INK_ON_MUTED.map((entry) => entry.utility),
);

/**
 * The PRESCRIBED answer — what every D-16 re-inking moves to. 6.9620 on the muted fill.
 *
 * Carried here so `groundInk.test.ts`'s ground-side negative control and any future
 * re-inking plan read the same token, rather than each picking one that "looks right".
 */
export const PRESCRIBED_INK_ON_MUTED = {
  utility: 'text-content-secondary',
  cssVar: '--color-text-secondary',
  ratio: 6.962,
} as const;
