/**
 * Req 1 (DES-01) repo-wide guard: no text-entry form control may render below 16px,
 * because mobile Safari focus-zooms the whole page when one is tapped.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A RENDER TEST
 * -----------------------------------------------
 * The property is "every control in the app", and there is no single render that
 * reaches all of them — they live behind modals, tabs, role gates and fetch states
 * across 20+ surfaces. A per-surface render pin would also go green forever the
 * moment a 21st surface is added, which is the failure mode 88-19 called out for
 * named-control pins. So this walks the source instead.
 *
 * WHY IT DOES NOT USE THE PLAN'S GREP
 * -----------------------------------
 * 88-21's own verify gate is
 *     grep -rnE "<(input|select|textarea)[^>]*text-(xs|sm)" src
 * and it is VACUOUS: `grep` is line-based and `[^>]*` cannot cross a newline, but
 * every control in this repo writes its `className` on a different line from the
 * opening tag. Measured against the untouched pre-88-21 tree, that pattern matched
 * ZERO of the 14 controls that were actually carrying `text-sm` at the time. It
 * passes whether or not the work was done, so it can never fail and never protected
 * anything. The scanner below balances braces to read the whole opening tag.
 *
 * WHY IT ALSO SCANS `<Input>` / `<Textarea>` / `<SelectControl>` CALL SITES
 * ------------------------------------------------------------------------
 * A first cut of this file scanned raw DOM tags only, and its own negative check
 * exposed the hole: `<Input className="text-sm" />` renders at 14px and the raw-tag
 * scan cannot see it, because after adoption the control is a component. The
 * primitive is not self-defending here — it composes via `cn()`, i.e. `twMerge`,
 * where the CALLER's `text-sm` beats the primitive's own `text-base`. So the more
 * of the app that adopts the primitive, the blinder a raw-tag-only scan gets. Both
 * shapes are checked.
 *
 * Deliberately NOT asserted here: the 44px touch-target floor. That is a separate
 * requirement, it is explicitly gated on a call-site census (88-SPEC.md:111 — "never
 * a blanket rule with no census"), and DEF-88-20-01 owns it. Adding a height
 * assertion to this file would smuggle that decision in.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles } from '../../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '../..');

/** `<input type>` values that are not text entry — iOS does not focus-zoom these. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'range', 'file', 'color',
  'button', 'submit', 'reset', 'image', 'hidden',
]);

/** Class constants that carry `text-base` at their own definition site. */
const FLOORED_CLASS_CONSTANTS = /\b(controlClass|DEFAULT_SELECT_CLASS)\b/;

const SUB_16 = /(?<![\w:-])text-(xs|sm)(?![\w-])/;
const AT_LEAST_16 = /(?<![\w:-])text-(base|lg|xl)(?![\w-])/;
/** A breakpoint-prefixed size is never a fix: `md:` is the range phones sit BELOW. */
const BREAKPOINT_SIZE = /\b(sm|md|lg|xl|2xl):text-(base|lg|xl)/;

/** Blank out comments and string bodies, preserving byte offsets so lines stay right. */
function stripComments(text: string): string {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
    } else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let k = i; k < stop; k += 1) if (out[k] !== '\n') out[k] = ' ';
      i = stop;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** Read a full JSX opening tag from `start`, balancing {} () [] and strings. */
function readOpeningTag(text: string, start: number): string | null {
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
    i += 1;
  }
  return null;
}

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

interface Control {
  where: string;
  tag: string;
  inputType: string | null;
  /** True when the element is a primitive (or uses a floored class constant). */
  carriesFloorByConstruction: boolean;
}

function textEntryControls(): Control[] {
  const found: Control[] = [];
  for (const file of sourceFiles(SRC)) {
    const raw = fs.readFileSync(file, 'utf8');
    const scannable = stripComments(raw);
    // Raw DOM tags AND the three primitive components they get adopted onto.
    const opener = /<(input|select|textarea|Input|Textarea|SelectControl)(?=[\s/>])/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(scannable)) !== null) {
      const tag = readOpeningTag(scannable, match.index);
      if (!tag) continue;
      const typeMatch = /type=["']([a-z]+)["']/.exec(tag);
      const inputType = typeMatch ? typeMatch[1] : null;
      const isInput = match[1] === 'input' || match[1] === 'Input';
      if (isInput && inputType && NON_TEXT_INPUT_TYPES.has(inputType)) continue;
      // The primitives carry the floor themselves; only a caller override can break it.
      const isPrimitive = /^(Input|Textarea|SelectControl)$/.test(match[1]);
      const line = raw.slice(0, match.index).split('\n').length;
      found.push({
        where: `${path.relative(SRC, file)}:${line} <${match[1]}>`,
        tag,
        inputType,
        carriesFloorByConstruction: isPrimitive || FLOORED_CLASS_CONSTANTS.test(tag),
      });
    }
  }
  return found;
}

describe('Req 1 (DES-01): the 16px iOS focus-zoom floor, repo-wide', () => {
  const controls = textEntryControls();

  it('finds text-entry controls to check (guards against a scanner that silently matches nothing)', () => {
    // If a refactor breaks the scanner, every assertion below passes vacuously.
    // This is the exact failure mode of the grep gate this file replaces.
    expect(controls.length).toBeGreaterThan(3);
  });

  it('has no control carrying a sub-16px size', () => {
    const offenders = controls.filter((c) => SUB_16.test(c.tag)).map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it('has no control whose only 16px size is behind a breakpoint prefix', () => {
    // `md:` and up is the range phones sit ABOVE the zoom threshold anyway — a
    // breakpoint-prefixed size applies the safe value to desktop and the zooming
    // value to the one viewport that zooms. See the marker in ui/Input.tsx.
    const offenders = controls
      .filter((c) => BREAKPOINT_SIZE.test(c.tag) && !AT_LEAST_16.test(c.tag))
      .map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it('has every control take its size explicitly, not by inheritance', () => {
    // An unsized raw control renders at whatever its surface happens to set. That
    // can be correct today and silently drop below 16px when an ancestor changes,
    // so the contract is an explicit size or a primitive that carries one.
    const offenders = controls
      .filter((c) => !AT_LEAST_16.test(c.tag) && !c.carriesFloorByConstruction)
      .map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it('scans primitive call sites too, not just raw DOM tags', () => {
    // Regression guard on the scanner itself. Once a surface adopts <Input>, a
    // raw-tag-only scan goes blind to it — so if this count ever hits zero, the
    // three assertions above have quietly stopped covering the adopted surfaces.
    const primitiveSites = controls.filter((c) => /<(Input|Textarea|SelectControl)>/.test(c.where));
    expect(primitiveSites.length).toBeGreaterThan(20);
  });
});
