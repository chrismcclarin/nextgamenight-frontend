/**
 * Req 11 (D-11) repo-wide guard: the app never raises a native browser dialog. Blocking
 * `confirm()` / `alert()` / `prompt()` cannot be styled, cannot be themed, cannot be
 * dismissed by keyboard on the app's terms, and are the one surface a person cannot get a
 * screenshot of into a bug report. Destructive confirmation goes through `ConfirmDialog`;
 * failures go through `FetchErrorBanner` or a toast.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT THE GREP THE PLAN SPECIFIED
 * ------------------------------------------------------------
 * `88-29-PLAN.md` Task 2(b) already fixes one defect — the SPEC's `window.confirm` pattern
 * would go green with eight native confirms shipping — and specifies the bare global
 * `(^|[^.a-zA-Z_$])confirm\(` instead. That correction is right and is kept below. Two
 * further defects were MEASURED on this tree before the gate was armed:
 *
 *  1. IT IS THE WRONG POPULATION. DEF-88-16-01 recorded that Req 11 kills `confirm(` and
 *     leaves native `alert(` standing, and that a `confirm`-only gate is "the same class of
 *     false-negative OI-8 was written to fix, one identifier over". Measured today:
 *     `confirm(` is at ZERO and `alert(` is not. A gate on the narrow token would have
 *     armed green over live native dialogs. `prompt()` is included for the same reason
 *     before anyone reaches for it.
 *  2. THE WIDENED GREP IS RED ON A CORRECT TREE. `grep -rnE '(^|[^.a-zA-Z_$])alert\('`
 *     over `src` today returns SIX lines, and THREE of them are comments — including two
 *     DECISION markers this very plan wrote to record the fix. `prompt\(` is worse: all
 *     four of its bare-global matches are prose ("an empty-state prompt (fails…"), so that
 *     half of the gate is 100% false positives. DEF-88-25-01 predicted this precisely:
 *     *"a `(confirm|alert)\(` grep … would match every DECISION comment discussing them"*,
 *     and noted 88-11's convention of not writing the token inside a marker as the
 *     workaround. A comment-stripping scanner removes the need for that workaround — a
 *     marker can say plainly what it forbids, which is what makes markers findable.
 *
 * WHY NOT SIMPLY WIDEN `fetchErrorTreatment.test.ts`
 * -------------------------------------------------
 * DEF-88-25-01 suggests 88-29 depend on that file's shape and widen its `SURFACES` list.
 * That test pins "no native alert" on NINE NAMED surfaces, and a named-surface list is
 * green forever the moment surface N+1 lands — the vacuity mode DEF-88-21-01 describes.
 * The property here is repo-wide, so this scan is repo-wide and the residue is carried as
 * an explicit, counted, self-expiring exemption instead. `fetchErrorTreatment.test.ts`
 * keeps its own per-surface assertion; the two are complementary, not duplicates.
 *
 * PHASE 88.6-13 REVISITED THIS AND DELIBERATELY DID NOT WIDEN THE OTHER FILE'S `alert(`
 * SCAN — recorded here so it is not re-attempted as a consistency cleanup.
 * ---------------------------------------------------------------------------------
 * That plan DID widen `fetchErrorTreatment.test.ts`'s raw-message and `Failed to X`
 * assertions from the nine named surfaces to the whole `src/` tree, for exactly the
 * vacuity reason the paragraph above gives. Its `alert(` assertion stays on the nine, and
 * that asymmetry is a CONSEQUENCE, not an oversight:
 *
 *   - This file owns the repo-wide `alert(` property by the explicit written decision
 *     above, and holds `app/components/GameComboInput.js` as an exact-count `sites: 1`
 *     exemption in `ALERT_EXEMPT` below.
 *   - Widening the other file's `alert(` scan repo-wide would red on that same site — a
 *     site this suite already governs, counts exactly and expires automatically — and
 *     would create a SECOND answer to a question this suite already answers. Two answers
 *     is the drift the whole shared-scanner pass exists to remove.
 *
 * So `SURFACES` survives in that file ONLY as the `alert(` assertion's scope, pinned there
 * by a `SURFACES.length === 9` exact-count assertion so a later plan cannot change the
 * reach by quietly adding or removing an entry. Its `GameComboInput.js` raw-message and
 * `Failed to X` roster entries point at the SAME line as this file's `alert(` exemption;
 * plan 88.6-32 closes all three together.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertRosterShape, type ExemptionRoster } from '../test-utils/exemption';
import { lineAt, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

const rel = (file: string): string => path.relative(SRC, file);

/**
 * Native `alert()` calls that are known, named and NOT fixed by this plan — with the reason
 * and the owner, because an exemption with neither is indistinguishable from a miss.
 *
 * The value is the EXACT number of surviving call sites, not a boolean. A per-file
 * allowlist gives an exempt file a standing permission to grow more, and DEF-88-28-01
 * recorded a gate that could not fail precisely because it counted a superset of the
 * population it cared about. Test 4 asserts each count is exact in BOTH directions: adding
 * a fifth alert here reds, and fixing one of these reds too — so closing a site forces the
 * exemption to be deleted rather than left behind as a fossil permission.
 *
 * D-19 (plan 88.6-04): this roster is now typed on the SHARED schema in
 * `src/test-utils/exemption.ts`, and it is that module's first real subject. The only
 * change is `owner`: it was a prose STRING, in which "DEF-88-25-01 — same routing as
 * above." and "someone said it was fine" are the same type and pass the same check. It is
 * now the discriminated union, so the provenance is machine-checkable. Every `why` and both
 * `sites` counts are byte-unchanged — they are the record of why each site survived Phase
 * 88 and are not rewritten while being re-typed.
 *
 * CLOSED by plan 88.6-15 (2026-09-16): `PromptScheduleManager.js`'s TWO sites are gone and its
 * entry is DELETED rather than zeroed — the count is exact in both directions, so a fossil
 * `sites: 0` reds exactly as hard as a stale `sites: 2`. Both alerts became
 * `toast.error(getFetchErrorMessage(err, { fallback }))` carrying the UI-SPEC §6.3 ratified
 * strings ("We couldn't update/delete the schedule. Please try again."), which is precisely
 * what the deleted `why` said was blocking them: the register now has copy for both. Plan
 * 88.6-32 still owns GameComboInput's one; the target for this roster is 0.
 */
const ALERT_EXEMPT: ExemptionRoster = {
  'app/components/GameComboInput.js': {
    sites: 1,
    why:
      'Interpolates a raw upstream `error.message` into user-facing text as well as ' +
      'using a native dialog, so it is a T-88-25-01 site AND a Req 11 site. The fix is ' +
      '`getFetchErrorMessage(err, { fallback })` — the mechanism exists — but it still ' +
      'needs a fallback string from the Req 14 register.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01' },
  },
};

/** The three blocking browser dialogs, as bare globals or explicitly off `window`. */
const NATIVE = ['confirm', 'alert', 'prompt'] as const;
type Native = (typeof NATIVE)[number];

/**
 * Every native dialog call in real code (comments blanked, line numbers preserved).
 *
 * Both call forms are matched. The plan corrects the SPEC's `window.confirm` to the bare
 * global because the bare form is what ships here — but a gate that swaps one for the other
 * has simply moved the hole, so this matches BOTH. The `[^.\w$]` guard keeps method calls
 * (`toast.alert(...)`, `dialogs.confirm(...)`) out, which is what makes the bare-global
 * form meaningful in the first place.
 */
export function nativeDialogCalls(src: string): { line: number; fn: Native }[] {
  const code = withoutComments(src);
  const hits: { line: number; fn: Native }[] = [];
  const bare = new RegExp(`(^|[^.\\w$])(${NATIVE.join('|')})\\s*\\(`, 'g');
  for (const m of code.matchAll(bare)) {
    hits.push({ line: lineAt(code, m.index), fn: m[2] as Native });
  }
  const viaWindow = new RegExp(`\\bwindow\\.(${NATIVE.join('|')})\\s*\\(`, 'g');
  for (const m of code.matchAll(viaWindow)) {
    hits.push({ line: lineAt(code, m.index), fn: m[1] as Native });
  }
  return hits;
}

describe('Req 11 native browser dialogs', () => {
  const files = sourceFiles(SRC);
  const byFile = new Map(
    files.map((f) => [rel(f), nativeDialogCalls(fs.readFileSync(f, 'utf8'))]),
  );

  it('0. the sweep is scanning a representative app, and the detector is not dead', () => {
    expect(files.length).toBeGreaterThan(100);
    // It still finds the KNOWN survivors. Without this, "zero offenders" and "the matcher
    // went blind" look identical — and this gate's whole job is telling those apart.
    //
    // Deliberately `> 0` and not an exact count: the exact counts are test 4's job, and
    // duplicating them here would make one planted defect fail two assertions, which
    // muddies every future negative check of this file.
    expect(byFile.get('app/components/GameComboInput.js')?.length).toBeGreaterThan(0);
  });

  it('1. no source file raises a native `confirm()` or `prompt()` — no exemptions', () => {
    const offenders: string[] = [];
    for (const [file, hits] of byFile) {
      for (const hit of hits) {
        if (hit.fn === 'alert') continue;
        offenders.push(`${file}:${hit.line} ${hit.fn}()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. no source file raises a native `alert()` outside the named exemptions', () => {
    const offenders: string[] = [];
    for (const [file, hits] of byFile) {
      if (file in ALERT_EXEMPT) continue;
      for (const hit of hits) {
        if (hit.fn !== 'alert') continue;
        offenders.push(`${file}:${hit.line} alert()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('3. every alert exemption states a reason AND an owner', () => {
    // DEF-88-25-01's 19 unowned sites are the reason this is asserted rather than trusted:
    // "nothing exits scope into thin air" only holds if the owner is written down.
    for (const [file, entry] of Object.entries(ALERT_EXEMPT)) {
      expect(entry.why.length, `${file}: no reason`).toBeGreaterThan(80);
      // D-19: `owner` is the union now, so the old `toMatch` on the raw value cannot run.
      // The floor is UNCHANGED in strength — the same regex, applied to the cite text read
      // out of whichever arm carries it. That read is exactly what the union bought: under
      // the old string there was no arm to read, so any sentence containing "Phase " passed.
      // This file keeps its own `> 80` reason floor, which is stricter than the shared
      // schema's 40; `assertRosterShape` is an addition to it, never a replacement.
      const cite =
        entry.owner.kind === 'spec'
          ? entry.owner.id
          : entry.owner.kind === 'decision'
            ? entry.owner.marker
            : entry.owner.ruling;
      expect(cite, `${file}: no owner`).toMatch(/DEF-|Phase |plan /);
    }
  });

  it('3b. the roster satisfies the shared D-19 schema (test-utils/exemption)', () => {
    // The shipped roster is the shared schema's first real subject: a schema validated only
    // against fixtures is a schema nobody has to satisfy. `assertRosterShape` returns NAMED
    // violations, so a future hand edit that drops a reason or writes a prose owner fails
    // here with the file and the field, not as a boolean.
    expect(assertRosterShape(ALERT_EXEMPT)).toEqual([]);
  });

  it('4. each exemption\'s call-site count is EXACT — it can neither grow nor go stale', () => {
    const drift: string[] = [];
    for (const [file, entry] of Object.entries(ALERT_EXEMPT)) {
      const full = path.join(SRC, file);
      if (!fs.existsSync(full)) {
        drift.push(`${file} — exempt but MISSING; update this list`);
        continue;
      }
      const actual = (byFile.get(file) ?? []).filter((h) => h.fn === 'alert').length;
      if (actual !== entry.sites) {
        drift.push(
          actual > entry.sites
            ? `${file} — ${actual} alerts, exemption covers ${entry.sites}; a NEW native dialog landed`
            : `${file} — ${actual} alerts, exemption covers ${entry.sites}; ${entry.sites - actual} fixed, so shrink or delete this exemption`,
        );
      }
    }
    expect(drift).toEqual([]);
  });

  it('5. the detector makes the discriminations the plan\'s grep could not', () => {
    // The bare global, which the SPEC's `window.confirm` pattern missed entirely.
    expect(nativeDialogCalls('if (confirm("Delete?")) remove();').map((h) => h.fn)).toEqual([
      'confirm',
    ]);
    // ...and the explicit form, so correcting one spelling does not just move the hole.
    expect(nativeDialogCalls('if (window.confirm("Delete?")) remove();').map((h) => h.fn)).toEqual([
      'confirm',
    ]);
    expect(nativeDialogCalls('window.alert("x"); window.prompt("y");').map((h) => h.fn)).toEqual([
      'alert',
      'prompt',
    ]);
    // A METHOD named the same thing is not a native dialog — this is what the bare-global
    // form is for, and getting it wrong would make the gate unfixable.
    expect(nativeDialogCalls('toast.alert("saved");')).toEqual([]);
    expect(nativeDialogCalls('dialogs.confirm({ title });')).toEqual([]);
    expect(nativeDialogCalls('await ui.prompt("name");')).toEqual([]);
    // Comments must not trip it — including the two markers this plan wrote in
    // createGroup.js naming the call it removed, and the four prose uses of the word
    // "prompt (" that make a raw grep for that token 100% false positives here.
    expect(nativeDialogCalls('// replaced the native confirm() with ConfirmDialog')).toEqual([]);
    expect(
      nativeDialogCalls('/* over the browser\n   alert() it replaces, and over a\n   toast */\nconst x = 1;'),
    ).toEqual([]);
    expect(nativeDialogCalls('// over an empty-state prompt (fails the contrast floor)')).toEqual([]);
  });

  it('6. `ConfirmDialog` — the thing native confirm was replaced BY — still exists', () => {
    // The mirror of test 1: deleting every confirmation flow in the app would also make
    // test 1 pass. Req 11 is "destructive actions confirm through the primitive", not
    // "nothing confirms".
    const dialog = path.join(SRC, 'components/ui/ConfirmDialog.tsx');
    expect(fs.existsSync(dialog)).toBe(true);
    const adopters = files.filter((f) =>
      /from '.*ConfirmDialog'/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(adopters.length).toBeGreaterThanOrEqual(3);
  });
});
