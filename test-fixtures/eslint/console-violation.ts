// ESLint behavioral fixture (NOT app source — lives outside src/, outside the
// no-console legacy allowlist). src/lib/eslint-rules.test.ts lints this file and
// asserts the raw console.* below triggers `no-console` at severity 2 (ERROR).
export function emitViolation(): void {
  console.log('this raw console.* must be flagged as a no-console error');
}
