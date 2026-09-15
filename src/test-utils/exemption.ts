/**
 * The shared exemption schema: every scan suite's escape hatch, with provenance a MACHINE
 * can check.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Phase 88 shipped the working idiom in `src/app/nativeDialogs.test.ts`, whose roster
 * docblock (`:51-61` as measured 2026-09-15 — `88.6-04-PLAN.md` cites `:52-62`, one line
 * later) states the rule this module generalises, quoted verbatim:
 *
 *   "The value is the EXACT number of surviving call sites, not a boolean. A per-file
 *    allowlist gives an exempt file a standing permission to grow more, and DEF-88-28-01
 *    recorded a gate that could not fail precisely because it counted a superset of the
 *    population it cared about. Test 4 asserts each count is exact in BOTH directions:
 *    adding a fifth alert here reds, and fixing one of these reds too — so closing a site
 *    forces the exemption to be deleted rather than left behind as a fossil permission."
 *
 * Phase 88.6's "zero remaining" only means something if every surviving escape hatch
 * carries that exact count AND a provenance that can be told apart from a sentence.
 *
 * DECISION Phase 88.6-04 (D-19): `owner` is a DISCRIMINATED UNION on `kind`, chosen OVER
 * the shipped free-text `owner: string`. The whole point of provenance is that a machine
 * can tell a cited SPEC requirement, a cited in-code DECISION marker, and a dated owner
 * ruling apart from a sentence someone wrote. Under `owner: string` the shipped
 * "DEF-88-25-01 — same routing as above." and a bare "someone said it was fine" are the
 * same type and pass the same check, so an executor holding a REAL marker and an executor
 * holding an opinion are indistinguishable. Under the union the first is expressible and
 * the second is not: a genuinely new case cannot be typed, so it STOPS and becomes a
 * code-review decision fork instead of a silent widening. Rejected alternatives: (a)
 * `owner: string` with a regex (the shipped `nativeDialogs.test.ts:159` form —
 * `/DEF-|Phase |plan /` matches any prose containing those tokens, which is the hole);
 * (b) a single `owner: { id: string }` (loses the kind, so a DECISION marker and a dated
 * ruling cannot be validated differently, and the `DECISION` token / `YYYY-MM-DD` checks
 * below have nothing to attach to). Changing this back is a decision, not a cleanup.
 *
 * EXCLUSION IS NOT EXEMPTION
 * --------------------------
 * `Button.tsx`'s cva base is a scanner EXCLUSION and must NEVER appear as a roster entry.
 * An exclusion says "this is the DEFINITION of the thing being scanned for"; an exemption
 * says "this is a DEBT that survived". An exclusion lives inside each scanner (where the
 * population is defined) and never expires; an exemption lives here, is counted exactly,
 * and is deleted the moment its last site closes. Filing the cva base as an exemption
 * would give the definition a fossil permission to grow.
 *
 * TEST-ONLY, AND HELD SO BY MACHINE
 * ---------------------------------
 * This module adds no runtime dependency and must never be imported from `src/app`,
 * `src/components`, `src/lib` or any other shipped directory. Unlike `sourceScan.ts`
 * — which imports `node:fs`/`node:path` (`sourceScan.ts:39-40`) and would fail LOUD in a
 * client bundle — this file has no `node:` import and would bundle SILENTLY. That
 * asymmetry (T-88.6-08) is why `exemption.test.ts` walks every shipped file under `src/`
 * outside `src/test-utils/` and asserts zero importers, rather than trusting a promise.
 */

/**
 * WHO owns a surviving escape hatch. Three shapes, because there are exactly three
 * legitimate sources of permission in this project and each is checkable in a different
 * way:
 *
 *  - `spec`     — a ratified requirement owns it (`SPEC-88.6 R2 / D-10`).
 *  - `decision` — an in-code `DECISION` marker owns it; the marker text must actually
 *                 carry the greppable `DECISION` token, so the cite is findable.
 *  - `owner`    — the project owner ruled on it, on a date. The date is load-bearing: an
 *                 undated disposition cannot be re-tested against a later milestone's
 *                 tenets, which is the mechanism CLAUDE.md's "nothing exits scope into
 *                 thin air" rule depends on.
 */
export type Owner =
  | { kind: 'spec'; id: string }
  | { kind: 'decision'; marker: string }
  | { kind: 'owner'; date: string; ruling: string };

/** One surviving escape hatch: how many sites, why they survived, and who owns them. */
export interface Exemption {
  /** The EXACT number of surviving sites — never a boolean, never a ceiling. */
  sites: number;
  /** Why these sites survived. Prose, for a human; the machine only checks it exists. */
  why: string;
  /** The provenance. See `Owner`. */
  owner: Owner;
}

/**
 * A roster keyed by the repo-relative source path, in the same `app/components/Foo.js`
 * form `nativeDialogs.test.ts` already uses (relative to `src/`).
 */
export type ExemptionRoster = Record<string, Exemption>;

/** An owner ruling's date must be unambiguous; `2026-9-8` is not a parseable disposition. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The floor for `why`. A one-word reason is a reason-less entry wearing a string.
 *
 * Deliberately LOWER than `nativeDialogs.test.ts:158`'s shipped `> 80` for its own roster:
 * this is the shared floor every suite gets for free, and that file keeps its stricter
 * per-suite assertion alongside. Raising this is safe; lowering it loosens every gate in
 * the phase at once.
 */
const MIN_WHY_CHARS = 40;

function ownerViolations(file: string, owner: unknown): string[] {
  if (owner === undefined || owner === null) {
    return [`${file}: \`owner\` is missing — an unowned exemption is indistinguishable from a miss`];
  }
  if (typeof owner !== 'object') {
    return [
      `${file}: \`owner\` is prose (${typeof owner}), not provenance — cite a SPEC id, a DECISION marker, or a dated owner ruling`,
    ];
  }
  const kind = (owner as { kind?: unknown }).kind;
  switch (kind) {
    case 'spec': {
      const id = (owner as { id?: unknown }).id;
      return typeof id === 'string' && id.trim() !== ''
        ? []
        : [`${file}: \`owner.id\` is empty — a spec owner must cite a requirement`];
    }
    case 'decision': {
      const marker = (owner as { marker?: unknown }).marker;
      if (typeof marker !== 'string' || marker.trim() === '') {
        return [`${file}: \`owner.marker\` is empty — a decision owner must cite a marker`];
      }
      return marker.includes('DECISION')
        ? []
        : [
            `${file}: \`owner.marker\` does not carry the greppable DECISION token (${marker}) — an uncitable marker cannot be found by the next reader`,
          ];
    }
    case 'owner': {
      const out: string[] = [];
      const date = (owner as { date?: unknown }).date;
      const ruling = (owner as { ruling?: unknown }).ruling;
      if (typeof ruling !== 'string' || ruling.trim() === '') {
        out.push(`${file}: \`owner.ruling\` is missing — record WHAT was ruled, not just that it was`);
      }
      if (typeof date !== 'string' || !ISO_DATE.test(date)) {
        out.push(
          `${file}: \`owner.date\` must be YYYY-MM-DD, got ${JSON.stringify(date)} — an undated ruling cannot be re-tested against a later milestone`,
        );
      }
      return out;
    }
    default:
      return [
        `${file}: \`owner.kind\` must be 'spec' | 'decision' | 'owner', got ${JSON.stringify(kind)}`,
      ];
  }
}

/**
 * Shape check for a roster. Returns a list of human-readable violations; an EMPTY array
 * means valid, so a consuming suite asserts
 * `expect(assertRosterShape(MY_ROSTER)).toEqual([])` and gets a NAMED failure rather than
 * a boolean that says only "something is wrong somewhere".
 *
 * The parameter is typed `ExemptionRoster` for callers, but every field is re-checked at
 * runtime: the real hazard is an untyped `.js`-era roster or a hand edit, and `Exemption`
 * is erased at runtime so the type alone guards nothing (the same two-halves shape
 * `Heading.tsx` uses for its `level` union + allow-list).
 */
export function assertRosterShape(roster: ExemptionRoster): string[] {
  const violations: string[] = [];
  for (const [file, raw] of Object.entries(roster ?? {})) {
    if (raw === undefined || raw === null || typeof raw !== 'object') {
      violations.push(`${file}: entry is not an object`);
      continue;
    }
    const { sites, why, owner } = raw as { sites?: unknown; why?: unknown; owner?: unknown };

    if (typeof sites !== 'number' || !Number.isInteger(sites) || sites < 1) {
      violations.push(
        `${file}: \`sites\` must be a positive integer, got ${JSON.stringify(sites)} — a zero-site entry is a fossil permission and a fractional one is not a count`,
      );
    }

    if (typeof why !== 'string' || why.trim() === '') {
      violations.push(
        `${file}: \`why\` is missing or whitespace-only — an exemption with no reason is indistinguishable from a miss`,
      );
    } else if (why.trim().length < MIN_WHY_CHARS) {
      violations.push(
        `${file}: \`why\` is too short (${why.trim().length} < ${MIN_WHY_CHARS} chars) — a one-word reason is a reason-less entry wearing a string`,
      );
    }

    violations.push(...ownerViolations(file, owner));
  }
  return violations;
}

/**
 * The both-directions count comparison, generalised from `nativeDialogs.test.ts` test 4.
 *
 * `measured` is what the suite's own scanner actually found, keyed the same way as the
 * roster. For every roster key, `measured[key] ?? 0` must EQUAL `sites`:
 *
 *  - measured ABOVE the entry  -> a new offender landed in an exempt file;
 *  - measured BELOW the entry  -> an offender was fixed but the entry was not shrunk,
 *    which leaves a fossil permission covering sites that no longer exist;
 *  - measured non-zero with NO entry -> an unowned offender.
 *
 * All three are violations with distinct messages, because the fix for each is different.
 * The upward direction is what stops an entry being widened to absorb a new offender; the
 * downward direction is what forces the entry to be DELETED when its last site closes.
 *
 * An entry whose `sites` is not a finite number is skipped here and reported by
 * `assertRosterShape` instead — comparing against a non-count would produce a second,
 * misleading message for one defect.
 */
export function assertExactCounts(
  roster: ExemptionRoster,
  measured: Record<string, number>,
): string[] {
  const violations: string[] = [];
  const entries = roster ?? {};
  const counts = measured ?? {};

  for (const [file, raw] of Object.entries(entries)) {
    const expected = (raw as { sites?: unknown } | null | undefined)?.sites;
    if (typeof expected !== 'number' || !Number.isFinite(expected)) continue;
    const actual = counts[file] ?? 0;
    if (actual === expected) continue;
    violations.push(
      actual > expected
        ? `${file} — ${actual} sites, exemption covers ${expected}; a new offender landed in an exempt file`
        : `${file} — ${actual} sites, exemption covers ${expected}; ${expected - actual} fixed, so shrink the entry (delete it at 0)`,
    );
  }

  for (const [file, count] of Object.entries(counts)) {
    if (count > 0 && !(file in entries)) {
      violations.push(
        `${file} — ${count} sites and NO exemption entry; fix them or add an owned, counted entry`,
      );
    }
  }

  return violations;
}
