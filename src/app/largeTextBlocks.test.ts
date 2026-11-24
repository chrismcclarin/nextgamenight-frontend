// @vitest-environment node
// Reason: file reads only; it renders nothing and needs no DOM.
//
// Phase 89.6-05 (SPEC R6, D-08): the structure guard for the large-text building blocks.
//
// WHY. The building blocks (the bb- classes in src/app/globals.css) are silent when broken:
// a block deleted, moved out of its components layer, or given a rule that hides content throws
// nothing and fails no build. The rendered proof is the matrix, which runs late, in the e2e job:
// e2e/large-text-blocks.spec.ts ("DECISION Phase 89.6-02 (harness)").
// This file is the fast lane: it reds the quality job in seconds when the STRUCTURE goes, before
// the e2e job starts.
//
// WHAT IT DOES NOT PIN, ON PURPOSE. Behaviour is the matrix's to prove. The wrap and min-width
// declarations are deliberately not read here: an edit that adds a min-width of 0 to a text slot
// must pass this file and be caught by the matrix step, which is how SPEC AC-6 shows that step
// can fail.
//
// EVERY READ IS COMMENT-STRIPPED. The markers in globals.css name the very classes and
// declarations this file looks for. withoutComments blanks comments and keeps every offset;
// test 1 is a control on the stripper itself.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { withoutComments } from '../test-utils/sourceScan';

const GLOBALS = path.join(__dirname, 'globals.css');
const BUNDLE_GUARD = path.resolve(__dirname, '../../scripts/css-bundle-guard.mjs');

const raw = fs.readFileSync(GLOBALS, 'utf8');
const css = withoutComments(raw);

/** Every building-block class. Each must have a rule of its own. */
const BLOCK_CLASSES = [
  'bb-row',
  'bb-row-text',
  'bb-row-end',
  'bb-label',
  'bb-cluster',
  'bb-keep',
  'bb-chip',
  'bb-crumbs',
  'bb-media',
  'bb-media-row',
  'bb-media-text',
  'bb-columns',
  'bb-frame',
  'bb-breakable',
] as const;

/** The block roots the production bundle must hold (the bundle guard's required list). */
const BLOCK_ROOTS = ['bb-row', 'bb-cluster', 'bb-media', 'bb-columns', 'bb-frame'] as const;

interface Block {
  /** The text before the opening brace: a selector list or an at-rule. */
  header: string;
  /** The headers of the blocks this one sits in, outermost first. */
  ancestors: string[];
  /** Its own declarations: the text between its braces, less every nested block. */
  body: string;
}

/** Every block of a stylesheet, by a brace walk over comment-stripped text. */
function blocksOf(text: string): Block[] {
  const done: Block[] = [];
  const open: Array<Block & { from: number }> = [];
  let last = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === ';') {
      if (open.length) open[open.length - 1].body += text.slice(last, i + 1);
      last = i + 1;
    } else if (c === '{') {
      const header = text.slice(last, i).replace(/\s+/g, ' ').trim();
      open.push({ header, ancestors: open.map((b) => b.header), body: '', from: i });
      last = i + 1;
    } else if (c === '}') {
      const block = open.pop();
      if (block) {
        block.body += text.slice(last, i);
        done.push({ header: block.header, ancestors: block.ancestors, body: block.body });
      }
      last = i + 1;
    }
  }
  return done;
}

const blocks = blocksOf(css);

/** A header that names a building-block class anywhere in its selectors. */
const namesBlockClass = (header: string): boolean => /\.bb-[a-z]/.test(header);

/**
 * The class is the subject of one of the header's selectors: the last part of a selector, after
 * its last combinator. A class that only appears inside a :not() or as an ancestor does not count.
 */
function isSubject(header: string, cls: string): boolean {
  const withoutGroups = header.replace(/\([^()]*\)/g, '');
  return withoutGroups.split(',').some((selector) => {
    const parts = selector.trim().split(/[\s>+~]+/);
    const subject = parts[parts.length - 1] ?? '';
    return new RegExp(`\\.${cls}(?![\\w-])`).test(subject);
  });
}

const rulesFor = (cls: string): Block[] => blocks.filter((b) => !b.header.startsWith('@') && isSubject(b.header, cls));

describe('Phase 89.6-05 — the large-text building blocks keep their structure (SPEC R6, D-08)', () => {
  it('1. the comment stripper does real work: the length is kept and the marker text is gone', () => {
    expect(css.length, 'withoutComments must blank comments in place; a shorter text means every later read is of something else').toBe(raw.length);
    expect(raw.split('DECISION Phase 89.6-05').length - 1, 'globals.css no longer holds a Phase 89.6-05 marker, so this control proves nothing').toBeGreaterThan(0);
    expect(css.split('DECISION Phase 89.6-05').length - 1, 'marker text survived the stripper, so the reads below may be reading comments').toBe(0);
  });

  it('2. each of the 14 block classes has a rule, and every rule naming a block class sits in a components layer', () => {
    const missing = BLOCK_CLASSES.filter((cls) => rulesFor(cls).length === 0);
    expect(missing, 'these building-block classes have no rule of their own in globals.css').toEqual([]);

    const named = blocks.filter((b) => !b.header.startsWith('@') && namesBlockClass(b.header));
    expect(named.length, 'no rule naming a building-block class was found; the brace walk broke').toBeGreaterThanOrEqual(BLOCK_CLASSES.length);
    const misplaced = named
      .filter((b) => b.ancestors[0] !== '@layer components')
      .map((b) => `${b.header} (in: ${b.ancestors.join(' > ') || 'no layer'})`);
    expect(misplaced, 'these building-block rules are not inside @layer components; unlayered they beat every utility, in the utilities layer they tie with them').toEqual([]);
  });

  it('3. no block rule hides content, no container query sits in the block layer, and the media block is an inline-size container', () => {
    const hiding = blocks.filter((b) => namesBlockClass(b.header) && /display\s*:\s*none/.test(b.body)).map((b) => b.header);
    expect(hiding, 'a building-block rule sets display none; a drop is a call-site variant on a picture with a text twin, never a block rule').toEqual([]);

    const blockLayerHasQuery = blocks.filter((b) => b.header.startsWith('@container') && b.ancestors[0] === '@layer components').map((b) => b.header);
    expect(blockLayerHasQuery, 'a container query sits in a components layer; a display rule there loses to any display utility on the same element').toEqual([]);
    const queriedBlocks = blocks.filter((b) => namesBlockClass(b.header) && b.ancestors.some((a) => a.startsWith('@container'))).map((b) => b.header);
    expect(queriedBlocks, 'a building-block rule sits inside a container query').toEqual([]);

    const media = rulesFor('bb-media');
    expect(media.some((b) => /container-type\s*:\s*inline-size\s*;/.test(b.body)), 'the .bb-media rule does not declare container-type inline-size, so the call-site picture drops have nothing to query').toBe(true);
  });

  it('4. the theme block declares the three edge tokens, each in px', () => {
    const theme = blocks.filter((b) => b.header === '@theme inline');
    expect(theme.length, 'there is not exactly one @theme inline block').toBe(1);
    const declared = [...theme[0].body.matchAll(/--spacing-edge-([a-z]+)\s*:\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
    expect(declared.sort(), 'the edge tokens are not exactly edge-card 12px, edge-page 16px and edge-wide 24px; a rem value here doubles every page and card edge at 200% text').toEqual(['card: 12px', 'page: 16px', 'wide: 24px']);
  });

  it('5. the card utility falls back to the edge-wide token and declares no rem padding', () => {
    const card = blocks.filter((b) => b.header === '@utility card');
    expect(card.length, 'there is not exactly one @utility card block').toBe(1);
    const paddings = [...card[0].body.matchAll(/(?:^|[;\s])(padding[a-z-]*)\s*:\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
    expect(paddings, 'the card fallback padding is not the edge-wide token alone; a rem fallback draws 48px at 200% text on a site that lost its own padding').toEqual(['padding: --theme(--spacing-edge-wide)']);
  });

  it('6. the frame caps select, input and textarea at 100%, and no rule sizes a select except by max-width', () => {
    const caps = blocks.filter((b) => /^\.bb-frame :where\(/.test(b.header));
    expect(caps.length, 'there is not exactly one .bb-frame :where(...) rule').toBe(1);
    const listed = (caps[0].header.match(/:where\(([^)]*)\)/)?.[1] ?? '').split(',').map((s) => s.trim()).sort();
    expect(listed, 'the frame does not cap exactly select, input and textarea; an uncapped one scrolls the page sideways at 320 with 200% text').toEqual(['input', 'select', 'textarea']);
    expect(/max-width\s*:\s*100%\s*;/.test(caps[0].body), 'the frame rule does not declare max-width 100%').toBe(true);

    const namesSelect = (header: string) => /(^|[\s,>+~(])select(?![\w-])/.test(header);
    const sized = blocks
      .filter((b) => !b.header.startsWith('@') && namesSelect(b.header) && /(?:^|[;\s])(?:min-)?(?:width|inline-size)\s*:/.test(b.body))
      .map((b) => b.header);
    expect(sized, 'a rule gives a select a width or a minimum width; a native select keeps its own width up to the frame cap and the row it sits in wraps (owner pick O-M3 = A+)').toEqual([]);
  });

  it('7. the bundle guard requires the five block roots, and each has a rule', () => {
    const guard = fs.readFileSync(BUNDLE_GUARD, 'utf8');
    const list = guard.match(/const REQUIRED = \[([\s\S]*?)\];/)?.[1] ?? '';
    const required = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(required.length, 'the REQUIRED list of scripts/css-bundle-guard.mjs could not be read').toBeGreaterThan(0);
    const unguarded = BLOCK_ROOTS.filter((root) => !required.includes(root));
    expect(unguarded, 'the bundle guard does not require these block roots, so the production bundle could ship without them while the matrix, which compiles its own CSS, stays green').toEqual([]);
    const ruleless = BLOCK_ROOTS.filter((root) => rulesFor(root).length === 0);
    expect(ruleless, 'these block roots have no rule in globals.css').toEqual([]);
  });
});
