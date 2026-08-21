/**
 * Shared source-scanning primitives for Phase 88's drift-guard suites.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `tintTreatment.test.ts:47-50` records the reason verbatim:
 *
 *   "NOTE ON DUPLICATION: the chunk lexer below is a second copy of the one in
 *    `borderExplicitness.test.ts`. Importing it would re-register that file's suites in
 *    this file's context. Extracting both into a shared test helper is a candidate for
 *    88-29's gate-hygiene pass; it is deliberately not done here, mid-sweep."
 *
 * This is that pass. By the time 88-29 ran there were THREE byte-identical copies of
 * `stringChunks` (`borderExplicitness.test.ts:111`, `focusAndMotionTreatment.test.ts:77`,
 * `tintTreatment.test.ts:129`) and 88-29 needed a fourth and fifth. Verified identical
 * before the move (brace-balanced extraction of all three, pairwise diff: no differences
 * inside the function body).
 *
 * The lexer could not simply be imported from one suite into another — a test file's
 * module body registers its `describe` blocks, so importing `tintTreatment.test.ts` from
 * `borderExplicitness.test.ts` would run the tint suite inside the border file's context.
 * A non-test module is the only way to share it. That is why this lives under
 * `src/test-utils/` rather than beside the suites.
 *
 * DECISION Phase 88-29: a non-test shared module under `src/` — chosen OVER (a) a fourth
 * hand copy, and (b) exporting the lexer from one of the test files. (a) is the drift the
 * whole Phase 88 gate ledger is about: five copies of a scanner is five places a
 * correctness fix has to land, and four places it can be forgotten. (b) re-registers
 * suites, as the note above says. Nothing in the app imports this module, so it is not
 * bundled; it exists to be imported by `*.test.ts` only. Deleting it to "clean up an
 * unused file" breaks every drift guard at once — that is a decision, not a cleanup.
 *
 * NOT MOVED HERE, deliberately: the six `sourceFiles` copies. Their signatures genuinely
 * differ (`(dir)` vs `(dir, out = [])`, and `controlSizeFloor.test.tsx` walks a different
 * root), so converging them is a behaviour change to six shipped, negative-checked suites
 * rather than a verbatim move. `sourceFiles` below is the canonical shape for NEW suites;
 * the existing copies are logged for 88-31's residual pass.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every string-literal / template-static chunk at ANY nesting depth, comments removed.
 *
 * This is the load-bearing piece of every Phase 88 guard, and it is what a `grep` cannot
 * do. Three properties matter, each of which killed a shipped grep gate:
 *
 *  - It crosses NEWLINES. `DEF-88-21-01`'s control gate matched ZERO of 14 real controls
 *    because every className in this repo sits on a different line from its opening tag,
 *    and grep is line-based.
 *  - It recurses into `${...}` interpolations, so a class inside a ternary branch of a
 *    template literal is seen (`DEF-88-27-01`).
 *  - It DROPS comments — both `//` and block. Comment blindness red-lined gates in
 *    `DEF-88-25-02` (twice), `DEF-88-27-01` and `DEF-88-28-01`, because this phase's own
 *    DECISION markers necessarily quote the tokens they forbid.
 */
export function stringChunks(src: string): { offset: number; text: string }[] {
  const out: { offset: number; text: string }[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let buf = '';
      while (j < n) {
        if (src[j] === '\\') {
          buf += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (src[j] === c || src[j] === '\n') break;
        buf += src[j];
        j += 1;
      }
      out.push({ offset: i, text: buf });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let buf = '';
      let bufStart = j;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          const start = k;
          while (k < n && depth > 0) {
            const ch = src[k];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (ch === '"' || ch === "'" || ch === '`') {
              const q = ch;
              k += 1;
              while (k < n && src[k] !== q) {
                if (src[k] === '\\') k += 1;
                k += 1;
              }
            }
            k += 1;
          }
          out.push({ offset: bufStart, text: buf });
          buf = '';
          for (const inner of stringChunks(src.slice(start, k - 1))) {
            out.push({ offset: start + inner.offset, text: inner.text });
          }
          j = k;
          bufStart = j;
          continue;
        }
        buf += src[j];
        j += 1;
      }
      out.push({ offset: bufStart, text: buf });
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const k = src.indexOf('\n', i);
      i = k < 0 ? n : k;
    } else if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i);
      i = k < 0 ? n : k + 2;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * The same source text with comments blanked but every other byte and offset preserved,
 * so `slice(0, offset).split('\n').length` still reports the real line number.
 *
 * `stringChunks` is the right tool when the property lives inside a STRING (a className, a
 * copy string). This is the right tool when the property is CODE — a call expression like
 * `alert(...)`, or an object property like `boxShadow:` — which `stringChunks` cannot see
 * because code is exactly what it throws away.
 *
 * Blanking rather than deleting is deliberate: a comment-stripping pass that shortens the
 * text makes every reported line number wrong, and a guard that points at the wrong line
 * is a guard people stop trusting.
 */
export function withoutComments(src: string): string {
  const n = src.length;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      // Copy the whole literal verbatim; a `//` inside a string is not a comment.
      const q = c;
      out.push(c);
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          out.push(src.slice(j, j + 2));
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        // An unterminated single/double quote (an apostrophe in prose) must not swallow
        // the rest of the file: stop at the newline, exactly as `stringChunks` does.
        if (q !== '`' && src[j] === '\n') break;
        out.push(src[j]);
        j += 1;
      }
      if (j < n) out.push(src[j]);
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const k = src.indexOf('\n', i);
      const end = k < 0 ? n : k;
      out.push(' '.repeat(end - i));
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i);
      const end = k < 0 ? n : k + 2;
      // Preserve newlines so line numbers survive a multi-line block comment.
      out.push(src.slice(i, end).replace(/[^\n]/g, ' '));
      i = end;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

/** 1-based line number of a character offset. */
export function lineAt(src: string, offset: number): number {
  return src.slice(0, offset).split('\n').length;
}

/**
 * Every app source file under `dir`, recursively, excluding test and spec files.
 *
 * The extension list includes `.ts` on purpose. `DEF-88-28-01` PROBE C found 88-28's focus
 * gate blind to `.ts` because its `--include` list omitted it — and `src/components/ui/`,
 * where this phase's primitives live, is largely `.ts`/`.tsx`.
 */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
