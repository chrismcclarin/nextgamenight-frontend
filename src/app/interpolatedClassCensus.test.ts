/**
 * THE INTERPOLATED-TAILWIND-CLASS CENSUS — a permanent gate, not a fix list.
 *
 * DECISION Phase 88.6-47 (owner routing, 2026-09-21): this file is authored because the census
 * came back CLEAN, not in spite of it. The hazard that produced the W53 failure is a property of
 * how Tailwind v4 extracts candidates, and it will still be true next phase.
 *
 * WHAT HAPPENED, so the next reader does not have to go and find it. Plan 88.6-30 shipped two
 * attribute-gated utilities composed by INTERPOLATION — a `DATE_TIME_CONTROL` constant dropped
 * into a template literal in `Input.tsx`. Tailwind v4 extracts candidates from RAW SOURCE TEXT, so
 * the full candidate string existed in no scanned file and the compiler emitted NOTHING for either
 * one. The class names rendered onto the DOM node; the rules did not exist. Every gate in that run
 * was green — the class-string pins read the constant, jsdom performs no layout, and the emission
 * pin fed the compiler already-resolved strings, so it supplied its own answer. The owner's iPhone
 * found it. That is a FALSE GREEN, not a weak test (`88.6-30-SUMMARY.md`, "Task 1 REOPENED";
 * WINDOWS 176).
 *
 * HOW THIS FILE RELATES TO THE OTHER HALF. `src/components/ui/Input.test.tsx` compiles the real
 * `globals.css` through the project's own Tailwind with the real `@source` tree and greps the
 * OUTPUT. That proves ONE selector survives. This file proves something different and complementary:
 * that no NEW invisible candidate has been authored ANYWHERE in `src/`. Neither subsumes the other —
 * an emission pin can only assert selectors somebody thought to name.
 *
 * THE OWNER MARKER ON EVERY ROSTER ENTRY IS SELF-CITING, and that is deliberate rather than an
 * oversight. Plan 47 task 4 edits NO production source, so the only site in the repo carrying
 * `DECISION Phase 88.6-47` for these entries is this file's own header — right here. A reader who
 * greps `src/` for the marker and finds only test files has found the truth, not a missing marker.
 *
 * REGISTRY GAP, recorded rather than implied: this becomes the FIFTH 88.6-minted source-scan gate
 * absent from `ci.yml`'s `drift-gate-registry` list, joining `groundInk.test.ts`,
 * `errorEnvelopeReads.test.ts`, `btnCensus.test.tsx` and `shadowTier.test.ts`. A gate you can
 * disarm with `rm` is not a gate. That ruling is OPEN and stays open PAST this phase — plan 88.6-46
 * carries no registry-ruling task, only AC-11's dated disposition — so both ledger entries
 * (`.planning/deferred/phase-88.6.md`) were corrected to FIVE by this plan rather than a row being
 * added to `ci.yml` here, which is not an executor's call.
 */
import path from 'node:path';
import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assertExactCounts, assertRosterShape, type ExemptionRoster } from '../test-utils/exemption';
import { lineAt, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const rel = (file: string): string => path.relative(SRC, file);

/**
 * Tailwind utility PREFIXES, as an explicit allow-list authored as DATA.
 *
 * MEASURED, and this is the whole reason the list exists rather than a regex meaning "any
 * dash-segment": read loosely, detector 2 returns 18 hits at `ef40170` — ids, `name`s and cache
 * keys such as `invite-friend-${…}`, `local-${game.id}`, `member-role-${…}` — which is a roster
 * of noise, and a roster of noise is a roster nobody maintains. Against this list it returns 5.
 * `row`, `h` and `col` MUST stay in it: the tree genuinely wears `row-span-3`
 * (`src/app/userProfile/page.js:2559`), so `row-${x}` is a real candidate shape here and not a
 * hypothetical one.
 * Adding a prefix can only ADD hits (each needs a roster entry or a fix); removing one blinds the
 * detector. Both directions are decisions.
 */
const TAILWIND_PREFIXES: readonly string[] = [
  'bg', 'text', 'border', 'ring', 'shadow', 'from', 'via', 'to', 'fill', 'stroke', 'outline',
  'decoration', 'divide', 'accent', 'caret', 'placeholder',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'space', 'gap',
  'w', 'h', 'min', 'max', 'size', 'basis', 'flex', 'grow', 'shrink', 'order', 'col', 'row', 'grid',
  'object', 'rounded', 'opacity', 'z', 'top', 'right', 'bottom', 'left', 'inset', 'translate',
  'rotate', 'scale', 'skew', 'origin', 'font', 'leading', 'tracking', 'indent', 'align',
  'whitespace', 'break', 'truncate', 'list', 'underline', 'transition', 'duration', 'ease',
  'delay', 'animate', 'cursor', 'select', 'resize', 'scroll', 'snap', 'touch', 'will', 'aspect',
  'columns', 'container', 'float', 'clear', 'isolation', 'overflow', 'overscroll', 'position',
  'visible', 'invisible',
];

/**
 * PART ONE — THE DETECTORS, as data with one line each saying what shape they hunt.
 *
 * Each receives the text immediately BEFORE a `${` and the text immediately AFTER its matching
 * `}`. A hit means "a Tailwind CANDIDATE may be being assembled across an interpolation boundary",
 * which is the thing the v4 scanner cannot see. A hit is NOT automatically a defect — see the
 * roster in part three; most of this tree's hits are React `key`s.
 *
 * DELIBERATELY OUT OF SCOPE, recorded so the omission is a decision and not an oversight:
 * plain `+` concatenation (`'bg-' + shade`) and `.concat(…)`. Both measure ZERO in `src/` today,
 * and adding them would widen this file into a general string-building scanner. If either shape
 * ever appears, the right move is a fifth detector here, not a special case somewhere else.
 */
interface Detector {
  readonly id: 1 | 2 | 3 | 4;
  readonly what: string;
  readonly hit: (before: string, after: string) => boolean;
}

/** A literal Tailwind VARIANT segment (`md:`, `hover:`, `data-[state=open]:`) ending the text. */
const VARIANT_BEFORE = /(^|[^A-Za-z0-9_$-])([a-z][a-z0-9-]*(?:\[[^\]]*\])?):$/;
/**
 * An UNCLOSED arbitrary-value bracket ending the text: the last `[` has no `]` after it and
 * nothing quote-like in between, so `w-[calc(100%-` and `closest(`+"`"+`[` both match while
 * `statuses[`+"`"+` (a JS index into a map, quote immediately after the bracket) does not. The
 * quote exclusion is the whole difference between an arbitrary VALUE and an array/object INDEX,
 * and without it every template-literal map lookup in the tree joins the roster as noise.
 */
const ARBITRARY_BEFORE = /\[[^\]\s'"\x60]*$/;

/** A bare utility prefix ending the text, bounded so `invite-friend-` cannot match `friend`. */
const PREFIX_BEFORE = /(^|[^A-Za-z0-9_$-])([a-z][a-z0-9]*)-$/;

const DETECTORS: readonly Detector[] = [
  {
    id: 1,
    what:
      'an interpolation immediately followed by a variant separator and a utility fragment — ' +
      'the W53 shape (`${DATE_TIME_CONTROL}:appearance-none`)',
    hit: (_before, after) => /^:[a-z[]/.test(after),
  },
  {
    id: 2,
    what:
      'a Tailwind utility PREFIX immediately followed by an interpolation (`bg-${shade}`) — ' +
      'the prefix list is the allow-list above, never "any dash-segment"',
    hit: (before) => {
      const m = PREFIX_BEFORE.exec(before);
      return !!m && TAILWIND_PREFIXES.includes(m[2]);
    },
  },
  {
    id: 3,
    what:
      'an interpolation OPENING an arbitrary-value bracket (`w-[${gap}]`, `[${attr}]`) — ' +
      'the bracket makes the candidate unguessable to the scanner even when the prefix is static',
    hit: (before) => ARBITRARY_BEFORE.test(before),
  },
  {
    id: 4,
    what:
      'a LITERAL variant segment immediately followed by an interpolation (`md:${cls}`) — the ' +
      'MIRROR of detector 1, and the half the W53 shape does not cover. Added by the 2026-09-21 ' +
      'scoped review: a gate that catches `${v}:utility` but not `variant:${u}` reads as ' +
      'covering the hazard while covering half of it',
    hit: (before) => VARIANT_BEFORE.test(before),
  },
];

/** Every `${ … }` span in `text`, brace-balanced and string-aware. */
function interpolationSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const n = text.length;
  let i = 0;
  while (i < n - 1) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      let k = i + 2;
      while (k < n && depth > 0) {
        const ch = text[k];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        else if (ch === '"' || ch === "'" || ch === '`') {
          const q = ch;
          k += 1;
          while (k < n && text[k] !== q) {
            if (text[k] === '\\') k += 1;
            k += 1;
          }
        }
        k += 1;
      }
      spans.push([i, k]);
      i = k;
      continue;
    }
    i += 1;
  }
  return spans;
}

interface Hit {
  readonly detector: 1 | 2 | 3 | 4;
  readonly line: number;
  readonly snippet: string;
}

/** Run all four detectors over one already-comment-stripped text. */
function scanText(text: string): Hit[] {
  const out: Hit[] = [];
  for (const [start, end] of interpolationSpans(text)) {
    const before = text.slice(Math.max(0, start - 80), start);
    const after = text.slice(end, end + 40);
    for (const d of DETECTORS) {
      if (!d.hit(before, after)) continue;
      out.push({
        detector: d.id,
        line: lineAt(text, start),
        snippet: text.slice(start, Math.min(end + 24, text.length)).replace(/\s+/g, ' '),
      });
    }
  }
  return out;
}

/**
 * Non-test `src/` files. `sourceFiles` already drops `*.test.*` / `*.spec.*`; the two extra
 * exclusions are the `__tests__` directory shape and `src/test-utils/` — helper modules whose whole
 * job is to hold pattern strings, which would otherwise seed the roster with fixtures.
 */
function productionFiles(): string[] {
  return sourceFiles(SRC).filter((f) => {
    const r = rel(f);
    return !r.split(path.sep).includes('__tests__') && !r.startsWith('test-utils' + path.sep);
  });
}

function census(): { byFile: Record<string, number>; rows: { file: string; hit: Hit }[] } {
  const byFile: Record<string, number> = {};
  const rows: { file: string; hit: Hit }[] = [];
  for (const file of productionFiles()) {
    const text = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const hit of scanText(text)) {
      const r = rel(file);
      byFile[r] = (byFile[r] ?? 0) + 1;
      rows.push({ file: r, hit });
    }
  }
  return { byFile, rows };
}

/**
 * PART THREE — THE PRODUCTION ROSTER, keyed by FILE and never by line.
 *
 * Line-keyed rosters have already broken once in this phase; a class that moves ten lines is not a
 * new defect, and a roster that reds on it is a roster people start deleting entries from.
 *
 * MEASURED 2026-09-21 at `ef40170` + this plan's commits, by running the four detectors above over
 * the 193 non-test `src/` files: ELEVEN hits across EIGHT files. (An earlier revision of plan 47
 * recorded three, and the 2026-09-21 scoped review re-measured ten; the eleventh is the SECOND
 * interpolation on `userProfile/page.js:119` — that one line builds both `${typeKey}:email` and
 * `${typeKey}:sms`, and a per-LINE reading counts it once while a per-HIT reading counts it twice.
 * This file counts HITS, so the number is eleven. Restated here rather than rounded to match the
 * plan text.)
 *
 * NONE of the eleven is a class. They are React `key`s, map keys, a scope string and a CSS
 * attribute selector handed to `closest()` — so the CLEAN verdict stands and only the roster size
 * moved.
 */
const CENSUS_EXEMPT: ExemptionRoster = {
  'app/userProfile/page.js': {
    sites: 2,
    why:
      'Two status-MAP keys on one line: `statuses[\`${typeKey}:email\`]` and its `:sms` twin. ' +
      'The interpolation builds an object key for a lookup table, never a className — nothing here ' +
      'reaches a class attribute. Owner marker is SELF-CITING: task 4 edits no production source, ' +
      'so this file\'s own header is the only DECISION Phase 88.6-47 site for this entry.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/components/AvailabilityGrid.js': {
    sites: 1,
    why:
      'A React `key` (`row-${rowIndex}`) on a grid row. `row` is in the utility allow-list ' +
      'because `row-span-*` is real, so the detector fires by design; the string is handed to ' +
      'React\'s `key` prop and never to `className`. Owner marker is SELF-CITING — task 4 edits ' +
      'no production source, so this file\'s header is the only site carrying it.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/components/EventHeatmapBackground.js': {
    sites: 1,
    why:
      'A React `key` (`row-${row}`) on a heatmap row wrapper whose className is the literal ' +
      '`contents`. Same shape as AvailabilityGrid: a key, not a class. Owner marker is ' +
      'SELF-CITING — task 4 edits no production source, so this file\'s header is the only site.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/components/heatmap/WeekGrid.tsx': {
    sites: 1,
    why:
      'A React `key` (`h-${col}`) on a column cell. `h` is in the allow-list because `h-8` ' +
      'is real, so this fires by design; the value is a key. Owner marker is SELF-CITING — task 4 ' +
      'edits no production source, so this file\'s header is the only site carrying it.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/gameDetail/page.js': {
    sites: 2,
    why:
      'Two React `key`s (`row-${idx}`) on two different list rows. NOTE FOR PLANS 44 AND 45: ' +
      'this file is edited AFTER this plan, and the assertion below is exact in both directions, so ' +
      'deleting or adding one of these keys reds this test — the fix is to adjust THIS number, not ' +
      'to change the code. Owner marker is SELF-CITING (task 4 edits no production source).',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/components/heatmap/usePaintGesture.ts': {
    sites: 1,
    why:
      'A CSS ATTRIBUTE SELECTOR handed to `closest()` — `el?.closest?.(\`[${attribute}]\`)`. ' +
      'It is a DOM query, not a Tailwind arbitrary value; the brackets are selector syntax that ' +
      'happens to look like one. Owner marker is SELF-CITING — task 4 edits no production source, ' +
      'so this file\'s header is the only site carrying it.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/components/GroupGamesList.js': {
    sites: 2,
    why:
      'Two map keys of the form `custom:${username}`, identifying a non-member participant. The ' +
      'literal segment before the interpolation is a namespace, not a Tailwind variant. Owner ' +
      'marker is SELF-CITING — task 4 edits no production source, so this file\'s own header is ' +
      'the only DECISION Phase 88.6-47 site for this entry.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
  'app/groupHomePage/page.js': {
    sites: 1,
    why:
      'A SCOPE string (`group:${Router}`) used to key a value, not a class. `group` is a real ' +
      'Tailwind marker class, which is precisely why detector 4 fires on it and why the entry ' +
      'carries a reason rather than the detector carrying an exception. Owner marker is ' +
      'SELF-CITING — task 4 edits no production source.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-47' },
  },
};

/**
 * PART TWO — THE POSITIVE CONTROL, and it is the reason this file is worth having.
 *
 * A census that returns zero is indistinguishable from a census whose detectors stopped matching.
 * These fixtures are PLAIN STRINGS, never template literals, so nothing here is evaluated; and
 * test files are excluded from the Tailwind scanner by `@source not` (`globals.css`), so these
 * literals cannot themselves reach the build. That exclusion is what makes it safe to keep the two
 * real W53 shapes in the repo.
 */
const KNOWN_BAD: readonly { text: string; why: string }[] = [
  { text: '${DATE_TIME_CONTROL}:appearance-none', why: 'W53 shape 1 — shipped, emitted nothing' },
  { text: '${DATE_TIME_CONTROL}:min-w-0', why: 'W53 shape 2 — shipped, emitted nothing' },
  { text: 'bg-${shade}', why: 'detector 2 — a utility prefix completed by an interpolation' },
  { text: 'md:${cls}', why: 'detector 4 — a literal variant completed by an interpolation' },
  { text: 'hover:${cls}', why: 'detector 4 — the same shape on a state variant' },
  { text: 'w-[calc(100%-${gap})]', why: 'detector 3 — an interpolation inside an arbitrary value' },
];

const KNOWN_GOOD: readonly { text: string; why: string }[] = [
  { text: 'isOpen ? "bg-surface-card" : "bg-surface-muted"', why: 'whole literal classes chosen by a ternary — the scanner sees both' },
  { text: 'TONE_CLASS[tone]', why: 'a whole literal class looked up from a map — the literals live in the map' },
  { text: 'id="field-${name}"', why: 'an interpolated DOM id; `field` is not a utility prefix' },
  { text: 'key={"member-${id}"}', why: 'an interpolated React key; `member` is not a utility prefix' },
  { text: '"bg-" + shade', why: 'plain + concatenation — DELIBERATELY out of scope (measures 0 in src/ today); listed so the omission is recorded, not implied' },
];

describe('the interpolated-Tailwind-class census (Phase 88.6-47)', () => {
  it('1. POSITIVE CONTROL — every known-bad shape is detected, including both real W53 strings', () => {
    for (const { text, why } of KNOWN_BAD) {
      expect(
        scanText(text).length,
        'the census detectors no longer match ' + JSON.stringify(text) + ' (' + why + '). ' +
          'A detector that silently stopped matching turns this whole file into a green that ' +
          'means nothing — which is exactly the false green plan 88.6-30 shipped. Fix the ' +
          'detector; do NOT delete the fixture.',
      ).toBeGreaterThan(0);
    }
  });

  it('2. POSITIVE CONTROL — every known-good shape is ignored', () => {
    for (const { text, why } of KNOWN_GOOD) {
      expect(
        scanText(text),
        'the census now flags ' + JSON.stringify(text) + ' (' + why + '), which is a FALSE ' +
          'POSITIVE. A census that cries wolf gets a roster entry per innocent site and then ' +
          'stops being read. Narrow the detector rather than adding an exemption.',
      ).toEqual([]);
    }
  });

  it('3. the roster has provenance — every entry carries a reason and a machine-checkable owner (D-19)', () => {
    expect(assertRosterShape(CENSUS_EXEMPT)).toEqual([]);
  });

  it('4. the census over non-test src/ matches the roster EXACTLY, in both directions', () => {
    const { byFile, rows } = census();

    const detail = rows
      .map((r) => '  ' + r.file + ':' + r.hit.line + '  [detector ' + r.hit.detector + ']  ' + r.hit.snippet)
      .join('\n');

    expect(
      assertExactCounts(CENSUS_EXEMPT, byFile),
      'THE INTERPOLATED-CLASS CENSUS MOVED. This file is ' +
        'src/app/interpolatedClassCensus.test.ts, and it is exact in BOTH directions on purpose: a ' +
        'new hit reds, and a REMOVED hit also reds so a fossil entry cannot linger.\n\n' +
        'IF THE NEW HIT IS A REACT `key`, A MAP KEY OR A `closest()` SELECTOR, THE FIX IS A ' +
        'ROSTER ENTRY WITH A REASON — not a code change. Most of this tree\'s hits are exactly ' +
        'that.\n' +
        'IF IT IS GENUINELY A CLASS, THE FIX IS THE CODE, and it is urgent in a way that will not ' +
        'show up anywhere else: Tailwind v4 extracts candidates from RAW SOURCE TEXT, so a class ' +
        'assembled across an interpolation emits NOTHING. The class name renders onto the DOM node ' +
        'and the rule does not exist — invisible in the browser, invisible to every class-string ' +
        'pin, invisible to jsdom. That is what plan 88.6-30 shipped and the owner found on his ' +
        'iPhone.\n' +
        'A class assembled from a LOOKUP OF WHOLE LITERALS is fine (the scanner sees the literals ' +
        'in the map) and belongs in the roster with that reason.\n\n' +
        'Plans 88.6-44 and 88.6-45 edit eight production files AFTER this one, and ' +
        'app/gameDetail/page.js is already a roster file — if one of them moved a `row-${idx}` ' +
        'key, adjust the count here.\n\nFull census:\n' + detail,
    ).toEqual([]);
  });
});
