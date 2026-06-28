import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import * as path from 'node:path';

// GAP3: prove the ESLint enforcement behaviorally (not by grep). We invoke ESLint
// programmatically against committed fixtures that live OUTSIDE the no-console
// legacy allowlist and assert on messages[].ruleId + severity.
//
// This test file lives under src/lib/ (A3) because vitest's `include` is
// 'src/**/*.{test,spec}.{ts,tsx}' — a file at the repo root would silently never
// run. Fixture + config paths resolve relative to src/lib/ -> repo root.
const repoRoot = path.resolve(__dirname, '../../');
const consoleFixture = path.join(repoRoot, 'test-fixtures/eslint/console-violation.ts');
const tolocaleFixture = path.join(repoRoot, 'test-fixtures/eslint/tolocale-violation.ts');

describe('.eslintrc.json enforcement', () => {
  let eslint: ESLint;

  beforeAll(() => {
    // ESLint v8 resolves the repo-root .eslintrc.json hierarchy by default
    // (useEslintrc defaults to true and was removed from the v8 Options type).
    eslint = new ESLint({ cwd: repoRoot });
  });

  // Generous timeout: linting through eslint-config-next cold-inits the
  // TypeScript parser, which can exceed the 5s default under parallel load.
  it(
    'flags a raw console.* as no-console at severity 2 (ERROR)',
    async () => {
      const [result] = await eslint.lintFiles([consoleFixture]);
      const noConsole = result.messages.find((m) => m.ruleId === 'no-console');
      expect(noConsole, 'expected a no-console message on the console fixture').toBeDefined();
      expect(noConsole?.severity).toBe(2);
    },
    30000
  );

  it(
    'flags a raw toLocaleString as no-restricted-syntax at severity 1 (WARN)',
    async () => {
      const [result] = await eslint.lintFiles([tolocaleFixture]);
      const restricted = result.messages.find((m) => m.ruleId === 'no-restricted-syntax');
      expect(
        restricted,
        'expected a no-restricted-syntax message on the toLocale fixture'
      ).toBeDefined();
      expect(restricted?.severity).toBe(1);
    },
    30000
  );
});
