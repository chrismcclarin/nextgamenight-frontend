/**
 * `auditFormControls` — the fork-5 house-rule render audit, in ONE shared home.
 *
 * MOVED here by Phase 88.6-44 from `src/app/components/formLabels.audit.test.tsx` (where it was
 * a file-private function at `:86-105`). It is a MOVE, not a copy: `formLabels.audit.test.tsx`
 * re-imports it from here, and the composed audits plan 88.6-44 writes for `BringGamePicker`,
 * `createEvent` and `ScheduleForm` import the same function. Duplicating a 20-line assertion
 * across four suites was rejected outright — "writing a function N times is tech debt"
 * (owner, 2026-08-28) — because a widened rule in one copy is a rule the other three never
 * learn.
 *
 * THE RULE IT ASSERTS (owner-ruled 2026-08-17, `src/components/ui/Input.tsx:11-19`): every
 * rendered, non-hidden form control carries (a) an `id`, (b) a `name`, and (c) an
 * accessible-name source — a `label[for]` pointing at it, a wrapping `<label>`, `aria-label`,
 * or `aria-labelledby`. `id`/`name` are required even when `aria-label` names the control,
 * because the browser autofill heuristic does not read ARIA. axe cannot substitute for this
 * check: its `label` rule PASSES a placeholder-only input and it has no `id`/`name` rule at all.
 *
 * DECISION Phase 88.6-44 (T-88.6-124): this module lives in `src/test-utils/` and imports
 * `expect` from vitest — it is test-only code that ASSERTS, chosen OVER returning a failure list
 * for each caller to assert. Returning the list would let a caller forget the `expect` and turn
 * the audit into a no-op that looks like coverage; here a call IS an assertion. Rejected too: a
 * `.test.helpers.ts` suffix to dodge the source-scan census by name — the census excludes this
 * whole directory instead (`sourceScan.ts` `sourceFiles`, same commit), because helper modules
 * whose job is to hold pattern strings are fixtures, not app source, wherever they are named.
 */
import { expect } from 'vitest';

export function auditFormControls(root: HTMLElement): void {
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>('input, select, textarea')
  ).filter((el) => (el as HTMLInputElement).type !== 'hidden');
  expect(controls.length).toBeGreaterThan(0); // an empty audit proves nothing

  const failures: string[] = [];
  for (const el of controls) {
    const describe = `${el.tagName.toLowerCase()}#${el.id || '?'}[name=${el.getAttribute('name') || '?'}]`;
    if (!el.id) failures.push(`${describe}: missing id`);
    if (!el.getAttribute('name')) failures.push(`${describe}: missing name attribute`);
    const labelled =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.closest('label') ||
      (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    if (!labelled) failures.push(`${describe}: no associated label`);
  }
  expect(failures).toEqual([]);
}
