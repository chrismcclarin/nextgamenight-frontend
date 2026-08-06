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

const SRC = path.resolve(__dirname, '..');

/**
 * The eight per-CTA `min-h-11` markers D-36 is about: 87.8's `D-13/D-14/AF-2` markers, each of
 * which records the global `.btn` floor as REJECTED and parks the question with Phase 88.
 * Identified by their own content, NOT by file count and NOT by line number — nine waves of
 * edits moved every one of them (this plan's own text cites the pre-drift numbers).
 */
const FLOOR_MARKER = /DECISION Phase 87\.8 \(D-13\/D-14\/AF-2\)[\s\S]*?\*\//g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      out.push(full);
  }
  return out;
}

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
