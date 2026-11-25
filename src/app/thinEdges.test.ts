// @vitest-environment node
// Reason: file reads only; it renders nothing and needs no DOM.
//
// Phase 89.6-15 (owner pick O-M1 = D, 2026-11-22: 'Edges stay thin (16px page edge, 12px card
// edge)'; HR-9 as amended by SPEC A9: thin edges on EVERY card and bar): the thin-edges gate.
//
// WHY. A page gutter, a card edge or a bar edge written in rem (p-3, md:p-6, px-4) doubles when
// the reader sets text to 200%, and on a 320px phone those doubled edges take the width the words
// need: the Home group card's name lost about a quarter of its line to padding. The px edge
// tokens (edge-card 12px, edge-page 16px, edge-wide 24px, edge-roomy 32px, declared in the theme
// block of src/app/globals.css) look the same at normal text and stay put at 200%.
//
// WHAT IS NOT AN EDGE, ON PURPOSE. A control's own padding (a button, a chip, an input, a tile)
// is part of its tap target, not a reading edge, so CONTROL_RULES leaves it alone. Vertical
// padding (py, pt, pb) is never read: vertical room scrolls (GR: scrolling down is fine), and
// HR-9 is about reading width.
//
// THE PENDING MAP IS ONE-WAY. Card-like sites written with a bare p-3 or p-4 each need a card or
// control call, and plan 89.6-39 makes those calls. Until then each file's count of sites sits in
// PENDING, and test 5 holds it EXACT: a higher count is a new rem edge (red), a lower one must
// lower the entry in the same commit (red until it does). An entry can only fall.
//
// EVERY READ IS COMMENT-STRIPPED. Markers quote the very idioms this file forbids; the class
// strings are read with the shared lexer, which drops comments, after withoutComments.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/** Removal-owned (D-07): the tutorial screens are deleted later in the phase, so they are not read. */
const SKIP_DIRS = ['app/components/tutorial/'];

/** The rem edge idioms: each doubles at 200% text. The last is the static prose column's gutter. */
const REM_IDIOMS = ['p-3 md:p-6', 'p-4 md:p-6', 'p-3 md:p-4', 'p-3 sm:p-4', 'px-4 md:px-6', 'px-4 py-16'];

/** A link card (a class string with rounded-card, or the className of a Card) on a numeric 32px edge. */
const LINK_CARD_RULE = {
  card: (tokens: string[], isCardProp: boolean) => isCardProp || tokens.includes('rounded-card'),
  padding: /^(?:sm:)?p-8$/,
};

const RADIUS = new Set(['rounded-card', 'rounded-lg', 'rounded-xl']);
const STRIP_VARIANTS = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/** A card: a radius together with a border, a card or page ground, a status fill or a theme shadow; or the card utility. */
function CARD_RULE(tokens: string[]): boolean {
  if (tokens.includes('card')) return true;
  const bare = tokens.map((t) => t.replace(STRIP_VARIANTS, ''));
  if (!bare.some((t) => RADIUS.has(t))) return false;
  return bare.some(
    (t) =>
      t === 'border' ||
      t === 'bg-surface-card' ||
      t === 'bg-surface-page' ||
      t.startsWith('bg-status-') ||
      t.startsWith('shadow-theme-'),
  );
}

/** A bar: a sticky strip. */
function BAR_RULE(tokens: string[]): boolean {
  return tokens.includes('sticky');
}

/** A control's own padding is not an edge. A NAMED_CARDS entry outranks every rule here. */
const CONTROL_RULES: { test: (tokens: string[]) => boolean; reason: string }[] = [
  { test: (t) => t.includes('rounded-btn'), reason: 'a button-shaped control (rounded-btn)' },
  { test: (t) => t.includes('rounded-full'), reason: 'a pill, chip or round control (rounded-full)' },
  { test: (t) => t.includes('btn'), reason: 'the btn class: a button' },
  { test: (t) => t.includes('min-h-11') && t.includes('inline-flex'), reason: 'a 44px inline control' },
  { test: (t) => t.includes('min-h-11') && t.includes('min-w-11'), reason: 'a 44 x 44 tap floor: a toggle or icon control' },
  {
    test: (t) => t.includes('border-2') && t.includes('rounded-lg') && t.includes('text-3xl'),
    reason: 'an O-M4 control\'s padding, plan 89.6-25 (the Group Settings emoji tile)',
  },
];

/**
 * Sites the radius rule misses or a control rule would exclude. A constant entry names a class
 * constant (the check-in card's, which carry no radius); an anchor entry is a padding-free snippet
 * that occurs in exactly one class string of the file.
 */
const NAMED_CARDS: ({ file: string; constant: string } | { file: string; anchor: string })[] = [
  { file: 'app/components/OpenPollsList.js', constant: 'CARD_BODY_STATIC_CLASS' },
  { file: 'app/components/OpenPollsList.js', constant: 'CARD_BODY_BUTTON_CLASS' },
  { file: 'app/components/OpenPollsList.js', constant: 'CARD_KEBAB_CELL_CLASS' },
  { file: 'app/components/FeedbackForm.js', anchor: 'bg-surface-page border border-line rounded-md' },
  { file: 'app/components/FeedbackForm.js', anchor: 'border-2 border-dashed border-line rounded-md' },
  { file: 'app/components/StartPollModal.js', anchor: 'bg-status-error-subtle border border-status-error rounded-btn' },
];

/** Side padding, any breakpoint: p, px, pl, pr, ps, pe. */
const SIDE_PADDING = /^(?:p|px|pl|pr|ps|pe)-(.+)$/;
/** An edge token, or an arbitrary value built on one, or no padding at all. */
const EDGE_VALUE = /^(?:edge-(?:card|page|wide|roomy)|\[[^\]]*--spacing-edge-[^\]]*\]|0|px)$/;

/**
 * The files still holding rem edges, each with its exact count of offending class strings.
 * Owner 89.6-15 entries are this plan's; owner 89.6-39 entries are the bare-padding card calls.
 */
const PENDING: Record<string, { count: number; owner: '89.6-15' | '89.6-39' }> = {
  'app/components/AvailabilityForm.js': { count: 2, owner: '89.6-39' },
  'app/components/AvailabilityGrid.js': { count: 2, owner: '89.6-39' },
  'app/components/BallotOptionsEditor.js': { count: 1, owner: '89.6-39' },
  'app/components/BallotSection.js': { count: 4, owner: '89.6-39' },
  'app/components/BrowseMoreModal.js': { count: 1, owner: '89.6-15' },
  'app/components/CalendarListView.js': { count: 1, owner: '89.6-39' },
  'app/components/ClickableMemberName.js': { count: 2, owner: '89.6-39' },
  'app/components/EventScheduler.tsx': { count: 1, owner: '89.6-39' },
  'app/components/FeedbackForm.js': { count: 2, owner: '89.6-15' },
  'app/components/FriendInvitePanel.js': { count: 3, owner: '89.6-39' },
  'app/components/GroupLibrary.js': { count: 1, owner: '89.6-39' },
  'app/components/GroupSettings.js': { count: 2, owner: '89.6-15' },
  'app/components/HeatmapTooltip.js': { count: 2, owner: '89.6-39' },
  'app/components/ManageMembers.js': { count: 4, owner: '89.6-39' },
  'app/components/MemberSelector.js': { count: 1, owner: '89.6-39' },
  'app/components/OpenPollsList.js': { count: 3, owner: '89.6-15' },
  'app/components/PendingMemberBanner.js': { count: 1, owner: '89.6-39' },
  'app/components/ResponseDashboard.js': { count: 3, owner: '89.6-39' },
  'app/components/ScheduleList.js': { count: 1, owner: '89.6-39' },
  'app/components/StartPollModal.js': { count: 1, owner: '89.6-15' },
  'app/components/TimezoneNudgeBanner.js': { count: 1, owner: '89.6-39' },
  'app/components/createEvent.js': { count: 1, owner: '89.6-39' },
  'app/components/heatmap/WeekGrid.tsx': { count: 1, owner: '89.6-39' },
  'app/friends/page.js': { count: 6, owner: '89.6-39' },
  'app/groupPlanning/page.js': { count: 1, owner: '89.6-39' },
  'app/userProfile/page.js': { count: 9, owner: '89.6-39' },
  'components/ui/Banner.tsx': { count: 1, owner: '89.6-39' },
  'components/ui/dialog.tsx': { count: 1, owner: '89.6-39' },
};

/** The number of PENDING entries owned by 89.6-15 may only fall; Task 3 of the plan sets it to 0. */
const PENDING_OWNED_BY_15_CEILING = 5;

/** The page roots on the page token pair: pinned by a snippet once converted, a PENDING entry until then. */
const PAGE_ROOTS: { file: string; snippet: string | null }[] = [
  { file: 'app/userHome/UserHomePage.js', snippet: 'user-home-container max-w-[100rem] mx-auto w-full p-edge-page md:p-edge-wide' },
  { file: 'app/groupHomePage/page.js', snippet: 'p-edge-page md:p-edge-wide max-w-7xl mx-auto' },
  { file: 'app/groupPlanning/page.js', snippet: 'p-edge-page md:p-edge-wide max-w-7xl mx-auto' },
  { file: 'components/ui/CentredPageFrame.tsx', snippet: 'flex min-h-screen flex-col items-center justify-center p-edge-page md:p-edge-wide' },
  { file: 'app/availability-form/[token]/page.js', snippet: 'min-h-screen bg-surface-page py-8 px-edge-page md:px-edge-wide' },
  { file: 'app/about/page.js', snippet: 'max-w-3xl mx-auto px-edge-page py-16' },
  { file: 'app/privacy/page.js', snippet: 'max-w-3xl mx-auto px-edge-page py-16' },
  { file: 'app/terms/page.js', snippet: 'max-w-3xl mx-auto px-edge-page py-16' },
  { file: 'app/goodbye/page.tsx', snippet: 'max-w-3xl mx-auto px-edge-page py-16' },
];

type Rule = 'idiom' | 'link-card' | 'card-or-bar';
interface Violation {
  file: string;
  line: number;
  offset: number;
  rule: Rule;
  classes: string;
  detail: string;
}

function hasIdiom(text: string, idiom: string): boolean {
  const esc = idiom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(text);
}

function isCardProp(src: string, offset: number): boolean {
  // The chunk offset sits on the opening quote (or just after a backtick); look at the text before it.
  const before = src.slice(Math.max(0, offset - 300), offset);
  return /<Card\b[^<>]*\bclassName=\s*\{?\s*[`]?$/.test(before);
}

function namedChunkOffsets(file: string, src: string, chunks: { offset: number; text: string }[]): Set<number> {
  const out = new Set<number>();
  for (const entry of NAMED_CARDS) {
    if (entry.file !== file) continue;
    if ('constant' in entry) {
      const m = new RegExp(`const ${entry.constant}\\s*=\\s*`).exec(src);
      if (!m) continue;
      const at = m.index + m[0].length;
      const chunk = chunks.find((c) => c.offset >= at && c.offset <= at + 1);
      if (chunk) out.add(chunk.offset);
    } else {
      for (const c of chunks) if (c.text.includes(entry.anchor)) out.add(c.offset);
    }
  }
  return out;
}

function violationsIn(file: string, raw: string, excluded: string[] = []): Violation[] {
  const src = withoutComments(raw);
  const chunks = stringChunks(src);
  const named = namedChunkOffsets(file, src, chunks);
  const out: Violation[] = [];
  for (const chunk of chunks) {
    const tokens = chunk.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const base = { file, line: lineAt(src, chunk.offset), offset: chunk.offset, classes: chunk.text.trim() };
    for (const idiom of REM_IDIOMS) {
      if (hasIdiom(chunk.text, idiom)) out.push({ ...base, rule: 'idiom', detail: idiom });
    }
    const cardProp = isCardProp(src, chunk.offset);
    if (LINK_CARD_RULE.card(tokens, cardProp)) {
      for (const t of tokens) if (LINK_CARD_RULE.padding.test(t)) out.push({ ...base, rule: 'link-card', detail: t });
    }
    const isNamed = named.has(chunk.offset);
    const cardLike = isNamed || CARD_RULE(tokens) || BAR_RULE(tokens);
    if (!cardLike) continue;
    const control = isNamed ? undefined : CONTROL_RULES.find((r) => r.test(tokens));
    if (control) {
      excluded.push(`src/${file}:${base.line} [${control.reason}] "${base.classes}"`);
      continue;
    }
    const rem = tokens.filter((t) => {
      const m = SIDE_PADDING.exec(t.replace(STRIP_VARIANTS, ''));
      return m !== null && !EDGE_VALUE.test(m[1]);
    });
    if (rem.length > 0) out.push({ ...base, rule: 'card-or-bar', detail: rem.join(' ') });
  }
  return out;
}

function scan(): { files: string[]; byFile: Map<string, Violation[]>; excluded: string[] } {
  const files = sourceFiles(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((f) => !SKIP_DIRS.some((d) => f.startsWith(d)));
  const byFile = new Map<string, Violation[]>();
  const excluded: string[] = [];
  for (const file of files) {
    const v = violationsIn(file, fs.readFileSync(path.join(SRC, file), 'utf8'), excluded);
    if (v.length > 0) byFile.set(file, v);
  }
  return { files, byFile, excluded };
}

/** One count per offending class string, whatever rules it breaks. */
function countOf(v: Violation[]): number {
  return new Set(v.map((x) => x.offset)).size;
}

function say(v: Violation): string {
  return `src/${v.file}:${v.line} [${v.rule}: ${v.detail}] "${v.classes}"`;
}

describe('Phase 89.6-15 (O-M1 D, HR-9): every page gutter, card and bar edge is a px edge token', () => {
  const { files, byFile, excluded } = scan();

  // The report flag names a file to write (vitest holds console output of passing tests back).
  const reportTo = process.env.THIN_EDGES_REPORT;
  if (reportTo) {
    const lines: string[] = [];
    let total = 0;
    for (const [file, v] of [...byFile.entries()].sort()) {
      const rules = [...new Set(v.map((x) => x.rule))].sort().join(',');
      total += countOf(v);
      lines.push(`THIN-EDGES ${file} -> ${countOf(v)}, ${rules}`);
    }
    lines.push(`THIN-EDGES TOTAL ${total} in ${byFile.size} files`);
    for (const v of [...byFile.values()].flat()) lines.push(`SITE ${say(v)}`);
    for (const x of excluded) lines.push(`CONTROL ${x}`);
    fs.writeFileSync(reportTo, `${lines.join('\n')}\n`);
  }

  it('1. the scanner reads the tree, the stripper blanks a planted comment, and the card rule matches a planted card', () => {
    expect(files.length, 'the scanner read fewer than 100 source files, so the tests below report on a subset').toBeGreaterThanOrEqual(100);
    const planted = "// a note quoting p-3 md:p-6\n/* and again p-4 md:p-6 */\nconst a = 'flex';\n";
    expect(violationsIn('planted.js', planted), 'an idiom inside a comment was read as code').toEqual([]);
    const card = violationsIn('planted.js', "const c = 'rounded-card border border-line p-3';\n");
    expect(card.map((v) => v.rule), 'the card rule did not catch a planted bordered card on rem padding').toEqual(['card-or-bar']);
    // One planted string per control rule, each a card by the card rule, so every exclusion is
    // shown to work: deleting a rule reds this test.
    const markers = ['rounded-btn', 'rounded-full', 'btn', 'inline-flex min-h-11', 'min-h-11 min-w-11', 'border-2 text-3xl'];
    for (const marker of markers) {
      const planted = `const b = 'rounded-lg border ${marker} px-4';\n`;
      expect(violationsIn('planted.js', planted), `the planted control "${marker}" was read as a card`).toEqual([]);
    }
    expect(markers.length, 'a control rule has no planted string here').toBe(CONTROL_RULES.length);
  });

  it('2. no class string outside PENDING holds a rem edge idiom', () => {
    const found = [...byFile.entries()]
      .filter(([file]) => !PENDING[file])
      .flatMap(([, v]) => v.filter((x) => x.rule === 'idiom'))
      .map(say);
    expect(found, 'these class strings hold a rem edge idiom, which doubles at 200% text; use the edge tokens (p-edge-card, p-edge-page, p-edge-wide)').toEqual([]);
  });

  it('3. no link card outside PENDING holds a numeric 32px edge', () => {
    const found = [...byFile.entries()]
      .filter(([file]) => !PENDING[file])
      .flatMap(([, v]) => v.filter((x) => x.rule === 'link-card'))
      .map(say);
    expect(found, 'these link cards hold p-8 or sm:p-8, a rem edge that grows to 64px at 200% text; use p-edge-roomy').toEqual([]);
  });

  it('4. every card or bar outside PENDING has edge-token side padding, unless it is a control', () => {
    const found = [...byFile.entries()]
      .filter(([file]) => !PENDING[file])
      .flatMap(([, v]) => v.filter((x) => x.rule === 'card-or-bar'))
      .map(say);
    expect(found, 'these cards or bars carry rem side padding; a control is excluded only by a CONTROL_RULES entry').toEqual([]);
  });

  it('5. PENDING is exact and one-way: each file\'s count equals its entry, and every entry has an owner', () => {
    const wrong: string[] = [];
    for (const file of new Set([...byFile.keys(), ...Object.keys(PENDING)])) {
      const measured = countOf(byFile.get(file) ?? []);
      const entry = PENDING[file]?.count ?? 0;
      if (measured > entry) wrong.push(`src/${file}: ${measured} rem-edge class strings, PENDING allows ${entry} (a new rem edge): ${(byFile.get(file) ?? []).map(say).join(' | ')}`);
      if (measured < entry) wrong.push(`src/${file}: ${measured} rem-edge class strings, PENDING says ${entry}; lower the entry (or remove it at 0) in this commit`);
    }
    for (const [file, entry] of Object.entries(PENDING)) {
      if (entry.owner !== '89.6-15' && entry.owner !== '89.6-39') wrong.push(`src/${file}: owner ${String(entry.owner)} is neither 89.6-15 nor 89.6-39`);
    }
    expect(wrong).toEqual([]);
  });

  it('6. the page roots read the page token pair (pinned by snippet once converted)', () => {
    const wrong: string[] = [];
    for (const root of PAGE_ROOTS) {
      if (root.snippet === null) {
        if (!PENDING[root.file]) wrong.push(`src/${root.file}: an unconverted page root with no PENDING entry`);
        continue;
      }
      const src = withoutComments(fs.readFileSync(path.join(SRC, root.file), 'utf8'));
      const n = src.split(root.snippet).length - 1;
      if (n !== 1) wrong.push(`src/${root.file}: the page root "${root.snippet}" occurs ${n} times in code, expected 1`);
    }
    expect(wrong).toEqual([]);
  });

  it('7. the PENDING entries owned by 89.6-15 are at most PENDING_OWNED_BY_15_CEILING', () => {
    const owned = Object.entries(PENDING).filter(([, e]) => e.owner === '89.6-15').map(([f]) => f);
    expect(owned.length, `PENDING entries owned by 89.6-15: ${owned.join(', ')}`).toBeLessThanOrEqual(PENDING_OWNED_BY_15_CEILING);
  });
});
