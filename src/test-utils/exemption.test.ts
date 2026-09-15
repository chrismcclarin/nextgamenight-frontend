/**
 * The schema test for `exemption.ts` (D-19).
 *
 * A schema test that has never failed is a schema test that cannot fail, so every
 * assertion below was demonstrated RED against a deliberately neutered `exemption.ts`
 * before it was allowed to go green; the transcript is in `88.6-04-SUMMARY.md`.
 *
 * The malformed rosters are fed through ONE typed cast (`roster()` below) rather than by
 * widening `Exemption` — the same untyped-caller idiom `Heading.test.tsx` established in
 * plan 03. Widening the declared type to make the bad cases expressible would delete the
 * very property the type exists to hold.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertExactCounts, assertRosterShape, type ExemptionRoster } from './exemption';
import { sourceFiles, withoutComments } from './sourceScan';

/**
 * The untyped-caller idiom: reproduces the position of a hand edit or an untyped `.js`-era
 * roster, which is the hazard `assertRosterShape` exists for. Every violation case goes
 * through here; none of them widens `Exemption`.
 */
const roster = (r: Record<string, unknown>): ExemptionRoster => r as unknown as ExemptionRoster;

/** A `why` comfortably over the 40-char floor, so owner/count cases report ONE violation. */
const WHY =
  'Kept because the Req 14 copy register has no string for this surface yet; plan 15 closes it.';

const FILE = 'app/components/Example.js';

describe('D-19 exemption schema — assertRosterShape', () => {
  it('1. a well-formed roster with one entry of each Owner kind is valid', () => {
    const valid: ExemptionRoster = {
      'app/components/BrowseMoreModal.js': {
        sites: 2,
        why: WHY,
        owner: { kind: 'spec', id: 'SPEC-88.6 R2 / D-10' },
      },
      'app/global-error.tsx': {
        sites: 1,
        why: WHY,
        owner: { kind: 'decision', marker: 'DECISION Phase 88-09 D-20' },
      },
      'app/components/LandingPage.js': {
        sites: 3,
        why: WHY,
        owner: {
          kind: 'owner',
          date: '2026-09-08',
          ruling: 'Phase 88.9 W55 owns the landing hero block',
        },
      },
    };
    expect(assertRosterShape(valid)).toEqual([]);
  });

  it('2. a reason-less entry is reported — empty, whitespace-only, and too short', () => {
    const owner = { kind: 'spec', id: 'SPEC-88.6 R1' };
    const empty = assertRosterShape(roster({ [FILE]: { sites: 1, why: '', owner } }));
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain('missing or whitespace-only');

    const blank = assertRosterShape(roster({ [FILE]: { sites: 1, why: '   ', owner } }));
    expect(blank).toHaveLength(1);
    expect(blank[0]).toContain('missing or whitespace-only');

    // A one-word reason is a reason-less entry wearing a string. `'legacy'` is 6 chars
    // (88.6-04-PLAN.md calls it 12 — re-counted here, the string is the plan's).
    const short = assertRosterShape(roster({ [FILE]: { sites: 1, why: 'legacy', owner } }));
    expect(short).toHaveLength(1);
    expect(short[0]).toContain('too short');
  });

  it('3. a PROSE-ONLY owner is reported — the shipped pre-D-19 string is the input', () => {
    // The literal from `nativeDialogs.test.ts:83`, byte-for-byte. Using the real shipped
    // value makes this a genuine before/after of the D-19 upgrade rather than a strawman:
    // under `owner: string` this entry passed, and under the union it cannot be written.
    const violations = assertRosterShape(
      roster({
        [FILE]: { sites: 1, why: WHY, owner: 'DEF-88-25-01 — same routing as above.' },
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('is prose (string), not provenance');
  });

  it('4. a `decision` owner that cites no DECISION marker is reported', () => {
    const violations = assertRosterShape(
      roster({
        [FILE]: {
          sites: 1,
          why: WHY,
          owner: { kind: 'decision', marker: 'phase 65-02 two-tap' },
        },
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('does not carry the greppable DECISION token');
  });

  it('5. an `owner` ruling whose date is not YYYY-MM-DD is reported', () => {
    // An unparseable date is not a dated disposition, and an undated disposition cannot be
    // re-tested against a later milestone's tenets.
    const violations = assertRosterShape(
      roster({
        [FILE]: {
          sites: 1,
          why: WHY,
          owner: { kind: 'owner', date: '2026-9-8', ruling: 'the owner accepted this' },
        },
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('must be YYYY-MM-DD');
  });

  it('6. `sites: 0` and `sites: 2.5` are each reported', () => {
    const owner = { kind: 'spec', id: 'SPEC-88.6 R1' };
    // Zero is the fossil-permission case: an entry covering nothing still shields the file.
    const zero = assertRosterShape(roster({ [FILE]: { sites: 0, why: WHY, owner } }));
    expect(zero).toHaveLength(1);
    expect(zero[0]).toContain('positive integer');

    const fractional = assertRosterShape(roster({ [FILE]: { sites: 2.5, why: WHY, owner } }));
    expect(fractional).toHaveLength(1);
    expect(fractional[0]).toContain('positive integer');
  });
});

describe('D-19 exemption schema — assertExactCounts', () => {
  const ROSTER: ExemptionRoster = {
    [FILE]: { sites: 2, why: WHY, owner: { kind: 'spec', id: 'SPEC-88.6 R1' } },
  };

  it('7a. a measured count ABOVE the entry is a NEW OFFENDER in an exempt file', () => {
    const violations = assertExactCounts(ROSTER, { [FILE]: 3 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('new offender');
    // The two directions carry DISTINCT messages: an entry that absorbed a new offender
    // and an entry left standing over fixed sites need different fixes.
    expect(violations[0]).not.toContain('shrink the entry');
  });

  it('7b. a measured count BELOW the entry means SHRINK THE ENTRY, not leave it', () => {
    const violations = assertExactCounts(ROSTER, { [FILE]: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('shrink the entry');
    expect(violations[0]).not.toContain('new offender');
  });

  it('8. a measured non-zero count for a file with NO roster entry is reported', () => {
    const violations = assertExactCounts(ROSTER, {
      [FILE]: 2,
      'app/components/Unowned.js': 1,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('NO exemption entry');
  });

  it('9. NEGATIVE CONTROL — a roster and a measured map that agree exactly are valid', () => {
    expect(assertExactCounts(ROSTER, { [FILE]: 2 })).toEqual([]);
    expect(assertRosterShape(ROSTER)).toEqual([]);
  });
});

describe('T-88.6-08 containment — exemption.ts never reaches a shipped bundle', () => {
  const SRC = path.resolve(__dirname, '..');
  const TEST_UTILS = path.join(SRC, 'test-utils');
  const IMPORTS_EXEMPTION = /test-utils\/exemption/;

  it('10. no shipped file under `src/` outside `src/test-utils/` imports test-utils/exemption', () => {
    // The WHOLE tree, minus this module's own home — not the two named directories
    // `src/app` + `src/components`, so a future top-level directory under `src/` is
    // covered BY CONSTRUCTION rather than by someone remembering to add it.
    //
    // This is a WIDENING of the gate, recorded so it is never mistaken for a loosening.
    // Measured 2026-09-15 with
    //   find src/<dir> -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \) \
    //     | grep -v -E '\.(test|spec)\.' | wc -l
    // app 139 + components 20 + lib 32 + types 1 = 192 shipped files outside
    // `src/test-utils` (88.6-04-PLAN.md measured 191 on 2026-09-14; plan 03's Heading.tsx
    // is the file added since), against the 159 an `src/app` + `src/components` walk
    // reaches. The 32 unwalked `src/lib` files include `cn.ts` and `api.ts` — the two most
    // bundle-central modules in the app, i.e. exactly where the silent case lands.
    //
    // Why this module needs the gate at all when `sourceScan.ts` does not: `sourceScan.ts`
    // imports `node:fs`/`node:path` (`sourceScan.ts:39-40`) and would fail LOUD if it ever
    // reached a client bundle. `exemption.ts` has no `node:` import and would ship
    // silently.
    const shipped = sourceFiles(SRC).filter((f) => !f.startsWith(TEST_UTILS + path.sep));
    expect(shipped.length).toBeGreaterThan(150);
    // The walk must actually reach `src/lib` — the directory the narrower two-directory
    // form missed. A count alone cannot tell "reaches lib" from "reaches 150 app files".
    expect(shipped.some((f) => f.startsWith(path.join(SRC, 'lib') + path.sep))).toBe(true);

    const importers = shipped.filter((f) =>
      IMPORTS_EXEMPTION.test(withoutComments(fs.readFileSync(f, 'utf8'))),
    );
    expect(importers.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('11. POSITIVE CONTROL — the importer detector is not dead', () => {
    // Without this, "zero importers" and "the matcher went blind" look identical. Both
    // spellings a shipped file could reach this module by are checked.
    expect(IMPORTS_EXEMPTION.test("import { assertRosterShape } from '../test-utils/exemption';")).toBe(true);
    expect(IMPORTS_EXEMPTION.test("import type { Exemption } from '@/test-utils/exemption';")).toBe(true);
    // ...and a comment mentioning the module is NOT an import, which is why the scan runs
    // over `withoutComments` — this file's own docblocks name the module repeatedly.
    expect(withoutComments('// see test-utils/exemption for the schema').trim()).toBe('');
  });
});
