/**
 * D-36 / D-37 — the decision markers Phase 88 OVERRODE must say so, in place.
 *
 * WHY MARKERS ARE TESTED AT ALL
 * -----------------------------
 * This project's Evidence Rule says a decision with no marker is invisible to every future
 * phase: planners sweep for `DECISION Phase NN` comments, and what they cannot find they
 * overwrite. Phase 65-02's two-tap confirm survived Phase 88's discuss ONLY because someone
 * had left one. So when Phase 88 answered a question that 87.8 had parked — and reversed half
 * of the reasoning behind it — the markers recording 87.8's answer became actively misleading,
 * and "delete them, they're stale" is the worst of the three options.
 *
 * D-36 and D-37 both therefore say AMEND, NEVER DELETE. That is a property of the source, so
 * it is testable, and — given what the two gates below turned out to be — it needs to be.
 *
 * WHY THIS DOES NOT USE THE PLAN'S GATE — MEASURED, NOT ASSERTED
 * -------------------------------------------------------------
 * 88-28's Task 3 gate is
 *     test "$(grep -rl 'DECISION Phase 87.8' src --include='*.js' | wc -l)" -ge 6
 *     && grep -q "88-28" src/app/components/ClickableMemberName.js
 * Both halves are false-negative, measured on this tree:
 *
 *  - IT COUNTS FILES, NOT MARKERS, AND HAS SIX FILES OF SLACK. Twelve files carry a
 *    `DECISION Phase 87.8` comment; only EIGHT markers in SIX files are the floor markers D-36
 *    is about. Deleting two of the eight leaves ten files -> still `-ge 6` -> GREEN (probed).
 *    Deleting ALL EIGHT still leaves ten files, because every one of those six files carries
 *    an unrelated 87.8 marker too (`AvailabilityGrid` TOUCH, `FeedbackButton` DEC-2,
 *    `NotificationBell` D-12, `CalendarMonthView` R10, `globals.css` x4...). The gate cannot
 *    fail for the thing it exists to prevent.
 *  - `grep -q "88-28"` MATCHES ANY OCCURRENCE. The file contains three by the end of this
 *    plan (the D-37 amendment, the keyboard-operability marker, and a test-file reference).
 *    Deleting the ENTIRE D-37 amendment while leaving the unrelated ones left the gate GREEN
 *    (probed). It checks that a string exists somewhere in a 350-line file, not that the
 *    amendment was made.
 *
 * That is the twelfth defective gate recorded in Phase 88 (see DEF-88-21-01, DEF-88-24-04,
 * DEF-88-25-02, DEF-88-27-01). It is also the fourth distinct SHAPE: not a regex that cannot
 * see the token, but a COUNT with enough slack to absorb the entire defect. Worth naming for
 * 88-29's gate-hygiene pass — "assert a threshold on a superset" is its own failure mode.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/**
 * The eight per-CTA `min-h-11` markers D-36 is about: 87.8's `D-13/D-14/AF-2` markers, each of
 * which records the global `.btn` floor as REJECTED and parks the question with Phase 88.
 * Identified by their own content, NOT by file count and NOT by line number — nine waves of
 * edits moved every one of them (this plan's own text cites the pre-drift numbers).
 */
const FLOOR_MARKER = /DECISION Phase 87\.8 \(D-13\/D-14\/AF-2\)[\s\S]*?\*\//g;

// DECISION Phase 88-31 (DEF-88-29-01): `sourceFiles` is IMPORTED from
// `src/test-utils/sourceScan.ts`, chosen OVER keeping this suite's private copy.
//
// 88-29 extracted `stringChunks` and deliberately left `sourceFiles` alone, because its six
// copies had visibly different SIGNATURES — `(dir)` vs `(dir, out = [])` vs `(dir, acc = [])`
// — and converging them from the plan whose job was arming gates would have been an
// unannounced behaviour change to six shipped, negative-checked suites. This is the residual
// pass that entry named as the owner, and the convergence was MEASURED before it was made,
// not assumed from reading:
//   - four copies (this one's family) were semantically identical to the canonical one;
//   - `cardPaddingIdiom`'s carried an extra `node_modules` skip, and there are ZERO
//     `node_modules` directories under `src/` (measured), so it was dead;
//   - `controlSizeFloor`'s excluded `.test.` but NOT `.spec.`, and there are ZERO `.spec.`
//     files under `src/` (measured), so its set was identical too. Its root is `src/`, the
//     same as everyone else's — the "different root" in the deferral was a misreading.
// So all six enumerated the same files, and this is a verbatim move rather than a behaviour
// change. Each suite's own anti-vacuity floor (`files.length > 100`) still holds afterwards.
//
// Re-inlining a private copy here is a decision, not a cleanup: six copies of a directory
// walker is five places a correctness fix — a new extension, a newly-excluded directory — can
// be forgotten, which is the drift shape the Phase 88 gate ledger records fifteen times, one
// layer down.

function allFloorMarkers(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(FLOOR_MARKER)) {
      out.push({ file: path.relative(SRC, file), text: m[0] });
    }
  }
  return out;
}

describe('D-36 — the eight rejected-floor markers are amended, never deleted', () => {
  const markers = allFloorMarkers();

  it('1. all EIGHT still exist (the count is of MARKERS, not of files)', () => {
    // The plan's gate counted files with six of slack. This counts the markers themselves, so
    // deleting even one fails. 87.8-08 + 87.8-01 wrote exactly eight.
    expect(markers).toHaveLength(8);
    expect(new Set(markers.map((m) => m.file)).size).toBe(6);
  });

  it('2. every one records the phase-88 ruling', () => {
    const missing = markers.filter((m) => !m.text.includes('AMENDED Phase 88-28 (D-36)'));
    expect(missing.map((m) => m.file)).toEqual([]);
  });

  it('3. every one names BOTH halves of the split — what was taken AND what stays rejected', () => {
    // A marker that says only "a floor was added" is worse than none: the next reader deletes
    // the per-CTA min-h-11 as redundant and silently shrinks a desktop CTA to ~37px.
    const bad: string[] = [];
    for (const m of markers) {
      const taken = /width < 48rem/.test(m.text) && /btn-compact/.test(m.text);
      const rejected = /STILL REJECTED/.test(m.text) && /ALL-VIEWPORT/i.test(m.text);
      const consequence = /desktop/i.test(m.text) && /88-31/.test(m.text);
      if (!taken || !rejected || !consequence) {
        bad.push(`${m.file} (taken=${taken} rejected=${rejected} consequence=${consequence})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('4. every one KEEPS its original reasoning as history', () => {
    // D-36's instruction is amend, not replace — the original text is the record of WHY the
    // all-viewport floor was rejected, which is the half that is still live.
    const lost = markers.filter(
      (m) => !/chosen OVER/.test(m.text) || !/AF-2/.test(m.text) || !/D-14/.test(m.text),
    );
    expect(lost.map((m) => m.file)).toEqual([]);
  });

  it('5. the phone floor and its opt-out really are shipped, so the markers are not lying', () => {
    const css = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');
    expect(css).toMatch(/@media\s*\(\s*width\s*<\s*48rem\s*\)[\s\S]*?\.btn\s*\{[\s\S]*?min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.btn-compact\s*\{[\s\S]*?min-height:\s*0/);
    const stepper = fs.readFileSync(path.join(SRC, 'app/components/BrowseMoreModal.js'), 'utf8');
    expect([...stepper.matchAll(/btn-compact/g)].length).toBeGreaterThanOrEqual(2);
  });
});

describe('D-37 — the add-friend 44x32 marker is amended in place, and the lever is not pulled', () => {
  const file = path.join(SRC, 'app/components/ClickableMemberName.js');
  const src = fs.readFileSync(file, 'utf8');

  it('6. the original 87.8 R4 marker is still there, not replaced', () => {
    expect(src).toContain('DECISION Phase 87.8 R4');
    expect(src).toContain('asymmetric ON'); // its original opening reasoning
    expect(src).toContain('OWNER-ACCEPTED deviation from the 44x44 floor');
  });

  it('7. the amendment records the accepted-forever RULING, not just that a phase looked at it', () => {
    const amendment = src.slice(src.indexOf('AMENDED Phase 88-28 (D-37)'));
    expect(amendment.length).toBeGreaterThan(0);
    expect(amendment).toMatch(/ACCEPTED FOREVER/);
    expect(amendment).toMatch(/e2e assertion[\s\S]{0,120}44x32/);
  });

  it('8. and the CORRECTED premise: one constrained render site, not nine', () => {
    const amendment = src.slice(src.indexOf('AMENDED Phase 88-28 (D-37)'));
    expect(amendment).toMatch(/RsvpSection\.js:\d+/);
    expect(amendment).toMatch(/space-y-1/);
    expect(amendment).toMatch(/ONE lever, not nine/);
    // the corrected claim must be checkable, so the marker enumerates the other eight
    expect(amendment).toMatch(/ManageMembers\.js/);
    expect(amendment).toMatch(/gameDetail\/page\.js/);
  });

  it('9. the extension itself is UNCHANGED — the amendment is a record, not a redesign', () => {
    expect(src).toContain("after:-inset-x-2.5 after:-inset-y-1 after:content-['']");
  });

  it('10. the one lever is NOT pulled: RsvpSection still stacks its member rows at space-y-1', () => {
    const rsvp = fs.readFileSync(path.join(SRC, 'app/components/RsvpSection.js'), 'utf8');
    expect(rsvp).toContain('<div className="space-y-1">');
  });

  it('11. ANTI-VACUITY: the marker readers are content checks, not substring-anywhere checks', () => {
    // The plan's gate was `grep -q "88-28" <file>` against a file containing three unrelated
    // 88-28 mentions. These read the AMENDMENT BLOCK, so an unrelated mention cannot satisfy
    // them — demonstrated on a fixture rather than asserted.
    const decoy = 'a file mentioning 88-28 and DECISION Phase 87.8 R4 but amending nothing';
    expect(decoy).toContain('88-28'); // the old gate would pass...
    expect(decoy.includes('AMENDED Phase 88-28 (D-37)')).toBe(false); // ...these do not
    expect(/ACCEPTED FOREVER/.test(decoy)).toBe(false);
    // and the D-36 marker matcher must not match an arbitrary 87.8 comment
    expect('/* DECISION Phase 87.8 (D-12): pressed state */'.match(FLOOR_MARKER)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------
 * Phase 88.5 — the six records this phase must not lose (plan 88.5-11, SPEC Req 1/4/5/6).
 *
 * WHY THESE SIX AND NOT "THE 88.5 MARKERS" IN GENERAL. Each one below is a property a future
 * refactor can delete WITHOUT breaking a single behavioural test, which is precisely the set
 * this suite exists for:
 *
 *   1. THE REVERSAL. 88.5 removed a surface 88.1 ruled to be "the designed phone presentation".
 *      The marker recording that reversal is the only place a future planner learns that the
 *      absence of a phone bottom bar is a DECISION rather than an omission — and, just as
 *      importantly, which half of 88.1 M3 still stands.
 *   2. THE 88.1 MARKERS. Four of them describe a world that no longer exists. D-36/D-37's rule
 *      (AMEND, NEVER DELETE) applies to them exactly as it applied to 87.8's: a deleted marker
 *      takes the reasoning with it, and "it's stale" is the worst of the three options.
 *   3. THE BAR IS ACTUALLY GONE. A marker claiming a removal is worthless if the thing is still
 *      mounted somewhere — test 5's shape, applied to this phase.
 *   4/5. TWO SINGLE-SOURCE FAMILIES. `statusConfig` (SPEC Req 4, VALIDATION's Req-4 row) and the
 *      `upcomingEvents` selector family (SPEC Req 3 / D-06 / T-88.5-25). Both were extracted
 *      SPECIFICALLY so a second definition cannot appear; nothing else fails when one does.
 *   6. THE D-15 OPT-OUT. Its default (`true`) is what keeps ~9 shipped member rows byte-unchanged;
 *      flipping it silently strips touch users of their friend affordance on all of them.
 *
 * HYGIENE (this file's own rules, applied):
 *   - Anything COUNTED is counted against comment-stripped source (`withoutComments`), so a
 *     marker that names the token it forbids cannot invalidate its own gate. That failure shape
 *     is live here: `gameDetail/page.js:41` mentions `statusConfig` in prose, and `UserHomePage.js`
 *     had to word a marker around its own gate for exactly this reason.
 *   - Nothing asserts a threshold on a superset. Every marker check reads the MARKER BLOCK (via
 *     `block()` below), not "the string appears somewhere in the file" — the failure mode this
 *     file's header dissects at :23-36.
 *   - Test 20 is the anti-vacuity control, in the shape of test 11: it demonstrates on fixtures
 *     that these readers reject near-misses, rather than asserting that they would.
 * ------------------------------------------------------------------------------------------- */

const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel: string): string => withoutComments(read(rel));
const rel = (abs: string): string => path.relative(SRC, abs).split(path.sep).join('/');

/**
 * The comment block that OPENS with `head`, up to the end of that comment.
 *
 * Reading the block rather than the file is what makes these content checks: an unrelated
 * mention of "88.1" elsewhere in a 1200-line component cannot satisfy an assertion about the
 * amendment. Throws — loudly and by name — when the marker is gone, because a missing marker is
 * the exact thing being guarded against and a silent `''` would make every later assertion vacuous.
 */
function block(src: string, head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`marker not found: ${head}`);
  const end = src.indexOf('*/', start);
  return src.slice(start, end < 0 ? src.length : end);
}

describe('Phase 88.5 — the surface reversal and its records are pinned', () => {
  const UHP = read('app/userHome/UserHomePage.js');

  it('12. the REVERSAL is on the record, and names what it supersedes', () => {
    const marker = block(UHP, 'DECISION Phase 88.5 (SPEC Req 1)');
    expect(marker).toMatch(/A SURFACE REVERSAL/);
    expect(marker).toMatch(/WHAT THIS SUPERSEDES/);
    expect(marker).toMatch(/88\.1/);
    expect(marker).toMatch(/M3/);
    // A reversal with no rejected alternative is a changelog entry, not a decision.
    expect(marker).toMatch(/REJECTED/);
  });

  it('13. and states what is NOT reversed — the principle, and the column that stays hidden', () => {
    const marker = block(UHP, 'DECISION Phase 88.5 (SPEC Req 1)');
    // The half a future reader would otherwise "restore": M3's PRINCIPLE survives the removal
    // of M3's SURFACE. Without this sentence, "the bar was wrong" reads as "un-hide the column".
    expect(marker).toMatch(/NOT\*{0,2} REVERSED/);
    expect(marker).toMatch(/DESIGNED presentation/);
    expect(marker).toMatch(/right column/);
    expect(marker).toMatch(/untouched/);
    // ...and the claim is not lying: the column really is still viewport-gated. Asserted in
    // CODE, so deleting the gate reds this test even if the marker still says it is there.
    expect(code('app/userHome/UserHomePage.js')).toContain('hidden md:flex');
  });

  it('14. the four 88.1 markers were AMENDED, not deleted', () => {
    // Same rule as D-36/D-37 above, applied to this phase's supersessions. Each is read as a
    // BLOCK: the amendment must live inside the marker it amends, not merely in the same file.
    expect(block(UHP, 'DECISION Phase 88.1 (plan 10, Req 11b)')).toMatch(/AMENDED Phase 88\.5/);

    const footer = read('app/components/Footer.js');
    const spacer = block(footer, 'DECISION Phase 88.1 (Req 11a');
    expect(spacer).toMatch(/EXTENDED Phase 88\.1-20/); // 88.1's own amendment survives 88.5's
    expect(spacer).toMatch(/AMENDED Phase 88\.5/);
    expect(spacer).toMatch(/RETIRED/); // the amendment states the OUTCOME, not just that it looked

    const clv = read('app/components/CalendarListView.js');
    expect(block(clv, 'DECISION Phase 88.1-17')).toMatch(/AMENDED Phase 88\.5 \(D-04/);

    // 88.1-05 is the selector module's founding decision — 88.5 extends the family it created
    // rather than superseding it, so this one must simply still be here.
    expect(read('lib/upcomingEvents.ts')).toContain('DECISION Phase 88.1-05');
  });

  it('15. the bar really is gone — zero PhoneEventBar references in any source file', () => {
    // Against the real tree via the shared scan, not a shell grep: `sourceFiles` crosses every
    // extension and directory, and excludes `.test.`/`.spec.` files (so this suite's own mention
    // of the name cannot satisfy or invalidate it). Comments stripped, so a future marker is free
    // to name the deleted component in prose without reding this.
    const offenders = sourceFiles(SRC)
      .filter((f) => withoutComments(fs.readFileSync(f, 'utf8')).includes('PhoneEventBar'))
      .map(rel);
    expect(offenders).toEqual([]);
    // and the files themselves are deleted, not merely unreferenced
    expect(fs.existsSync(path.join(SRC, 'app/components/PhoneEventBar.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'app/components/PhoneEventBar.js'))).toBe(false);
  });
});

describe('Phase 88.5 — the two single-source families cannot grow a second definition', () => {
  it('16. `statusConfig` is declared in exactly ONE module, and both consumers import it', () => {
    // SPEC Req 4 / VALIDATION Req-4: the mechanical form of "no third RSVP idiom". Comment-
    // stripped, because `gameDetail/page.js:41` names `statusConfig` in prose — a raw grep here
    // would report a third "definition" that is a sentence.
    const declarers = sourceFiles(SRC)
      .filter((f) => /\bconst\s+statusConfig\b/.test(withoutComments(fs.readFileSync(f, 'utf8'))))
      .map(rel);
    expect(declarers).toEqual(['app/components/rsvpStatusConfig.ts']);

    for (const consumer of ['app/components/RsvpSection.js', 'app/components/NextGameNightCard.tsx']) {
      expect(code(consumer)).toMatch(/import\s*\{[^}]*\bstatusConfig\b[^}]*\}\s*from\s*'\.\/rsvpStatusConfig'/);
    }
  });

  it('17. `selectNextUpcoming` is the ONLY "next" definition, and nothing re-inlines its predicate', () => {
    const declarers = sourceFiles(SRC)
      .filter((f) => /\b(?:const|function)\s+selectNextUpcoming\b/.test(withoutComments(fs.readFileSync(f, 'utf8'))))
      .map(rel);
    expect(declarers).toEqual(['lib/upcomingEvents.ts']);

    // D-06 rejection (d): "a private inline copy of the live/future check inside CalendarListView
    // or any other sheet-side consumer — a third, unpinned definition of upcoming (T-88.5-25)."
    // The live-status literals are the fingerprint of that copy: any component re-deriving
    // "is this event live" has to name them, and `hasLiveStatus` is the only thing that may.
    const statusTesters = sourceFiles(SRC)
      .filter((f) => /['"]in_progress['"]/.test(withoutComments(fs.readFileSync(f, 'utf8'))))
      .map(rel);
    expect(statusTesters).toEqual(['lib/upcomingEvents.ts']);
  });
});

describe('Phase 88.5 — the D-15 indicator opt-out is marked at both required sites', () => {
  it('18. the PROP carries its marker, its default, and the arithmetic that forced it', () => {
    const cmn = read('app/components/ClickableMemberName.js');
    const marker = block(cmn, 'DECISION Phase 88.5 (D-15)');
    expect(marker).toMatch(/showInlineIndicator/);
    expect(marker).toMatch(/OPT-OUT/);
    // The default is the load-bearing half: an opt-IN silently flips ~9 shipped member rows.
    expect(marker).toMatch(/must stay `true`/);
    expect(marker).toMatch(/REJECTED/);
    // ...and the default really is `true` in the signature, not just in the prose.
    expect(code('app/components/ClickableMemberName.js')).toMatch(/showInlineIndicator\s*=\s*true/);
  });

  it('19. the CHIP CALL SITE carries its own marker, and really passes false', () => {
    const stack = read('app/components/MemberChipStack.tsx');
    const marker = block(stack, 'DECISION Phase 88.5 (D-15)');
    expect(marker).toMatch(/showInlineIndicator=\{false\}/);
    // WCAG 1.4.1: suppressing the indicator is only legal because a text carrier replaces it.
    expect(marker).toMatch(/accessible name|1\.4\.1/i);
    expect(code('app/components/MemberChipStack.tsx')).toMatch(/showInlineIndicator=\{false\}/);
  });
});

describe('Phase 88.5 — ANTI-VACUITY: the readers above reject near-misses', () => {
  it('20. demonstrated on fixtures, not asserted', () => {
    // (a) A marker with the right HEAD but none of the content must not satisfy test 12/13.
    const thinReversal = '/* DECISION Phase 88.5 (SPEC Req 1): removed the bar. */';
    expect(thinReversal).toContain('DECISION Phase 88.5 (SPEC Req 1)'); // a grep gate would pass
    const thin = block(thinReversal, 'DECISION Phase 88.5 (SPEC Req 1)');
    expect(/REJECTED/.test(thin)).toBe(false); // ...these do not
    expect(/NOT\*{0,2} REVERSED/.test(thin)).toBe(false);
    expect(/DESIGNED presentation/.test(thin)).toBe(false);

    // (b) An 88.1 marker in a file that mentions "AMENDED Phase 88.5" SOMEWHERE ELSE must not
    //     satisfy test 14 — the amendment has to be inside the block it amends.
    const decoyFile =
      '/* DECISION Phase 88.1 (plan 10, Req 11b): variant=secondary */\n' +
      'const x = 1;\n' +
      '/* AMENDED Phase 88.5 (D-02): an unrelated marker further down the file */';
    expect(decoyFile).toContain('AMENDED Phase 88.5'); // file-level check would pass
    expect(/AMENDED Phase 88\.5/.test(block(decoyFile, 'DECISION Phase 88.1 (plan 10, Req 11b)'))).toBe(false);

    // (c) The declaration counters must not fire on PROSE — the live shape at gameDetail:41.
    const prose = "// renders an RSVP maybe (RsvpSection's statusConfig, rsvp/[token]'s config map)";
    expect(prose).toContain('statusConfig'); // a raw grep would count this as a definition
    expect(/\bconst\s+statusConfig\b/.test(withoutComments(prose))).toBe(false);
    const markerNamingItsOwnToken =
      "/* DECISION: no component may test for 'in_progress' itself — use hasLiveStatus. */";
    expect(/['"]in_progress['"]/.test(withoutComments(markerNamingItsOwnToken))).toBe(false);

    // (d) A missing marker must FAIL LOUDLY rather than degrade to an empty, always-green block.
    expect(() => block('nothing here', 'DECISION Phase 88.5 (SPEC Req 1)')).toThrow(/marker not found/);
  });
});
