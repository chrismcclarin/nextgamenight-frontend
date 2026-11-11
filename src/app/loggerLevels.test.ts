// Phase 88.9-38 — owner ruling F1 / O-05 (chat 2026-11-07 6:35 PM Pacific; 88.9-UI-SPEC.md
// (d) Resolutions of (c), "O-05 -> F1 RULED"): the four quiet-failure sites log at the
// owner-ruled level.
//
//   F1-1 UserHomePage.js upcoming-events catch    -> warn (a Sentry warning event of its own)
//   F1-2 EventDayModal.js game-invite-token catch  -> warn
//   F1-3 EventCalendar.js fetchEvents catch         -> warn
//   F1-4a api.ts HTML-instead-of-JSON branch        -> warn
//   F1-4b api.ts generic fetch-boundary catch       -> info (the breadcrumb, kept)
//
// warn is src/lib/logger.ts ("Sentry.captureMessage(msg, { level: 'warning', extra: ctx });")
// and info is src/lib/logger.ts ("Sentry.addBreadcrumb({ message: msg, level: 'info', data: ctx });")
// — same (msg, ctx) shape, so each promotion is one word at the call site.
//
// The planning record, by heading: planning:.planning/deferred/phase-88.9.md, heading
// "Event-level reporting for destructive and user-visible action failures" (register row 50,
// the F1 half).
//
// HOW THE PIN READS: for each row it counts the call prefix (the logger method name, an
// opening parenthesis, and the message's opening text) in the named source file, for each of
// error, warn and info. The ruled method must count 1 and the other two 0, and the three
// counts must sum to 1 — so a renamed or deleted message reds instead of passing quietly.
// The message openings for F1-1, F1-2 and F1-3 end at the closing quote of the message, so
// the gameDetail page's two twins (the same words followed by a colon) are NOT F1 sites and
// never match; F1 did not name them (hand-off to plan 88.9-51).
//
// Phase 89 rewires the home page's events fetch: the F1-1 / F1-3 rows move to whichever catch
// survives that rewire, and the level travels with it.
//
// The shared source-scan test helper is NOT imported, by design: this file reads four named
// files directly, so it carries no drift-gate-registry row.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const FE_ROOT = path.resolve(__dirname, '..', '..');

type Method = 'error' | 'warn' | 'info';

interface Site {
  id: string;
  file: string;
  opening: string;
  ruled: Method;
}

const BACKTICK = String.fromCharCode(96);

const SITES: Site[] = [
  {
    id: 'F1-1',
    file: 'src/app/userHome/UserHomePage.js',
    opening: "'[UserHomePage] The upcoming-events request did not complete:'",
    ruled: 'warn',
  },
  {
    id: 'F1-2',
    file: 'src/app/components/EventDayModal.js',
    opening: "'Failed to get game invite token'",
    ruled: 'warn',
  },
  {
    id: 'F1-3',
    file: 'src/app/components/EventCalendar.js',
    opening: "'Error fetching events'",
    ruled: 'warn',
  },
  {
    id: 'F1-4a',
    file: 'src/lib/api.ts',
    opening: "'API Error: Received HTML instead of JSON.",
    ruled: 'warn',
  },
  {
    // A template literal: built by concatenation so this file holds no interpolation opener.
    id: 'F1-4b',
    file: 'src/lib/api.ts',
    opening: BACKTICK + 'API Error (',
    ruled: 'info',
  },
];

const METHODS: Method[] = ['error', 'warn', 'info'];

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

describe('88.9-38 F1 / O-05 — the four quiet-failure sites log at the owner-ruled level', () => {
  it('F1 (88.9): F1-1/F1-2/F1-3/F1-4a/F1-4b use the ruled method', () => {
    const problems: string[] = [];
    for (const site of SITES) {
      const source = fs.readFileSync(path.join(FE_ROOT, site.file), 'utf8');
      const counts = Object.fromEntries(
        METHODS.map((m) => [m, countOccurrences(source, 'logger.' + m + '(' + site.opening)]),
      ) as Record<Method, number>;
      const sum = counts.error + counts.warn + counts.info;
      const ok = sum === 1 && counts[site.ruled] === 1;
      if (!ok) {
        problems.push(
          site.id + ' in ' + site.file + ': ruled ' + site.ruled + ', counted error=' + counts.error
            + ' warn=' + counts.warn + ' info=' + counts.info,
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
