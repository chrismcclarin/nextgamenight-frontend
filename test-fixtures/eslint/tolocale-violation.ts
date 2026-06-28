// ESLint behavioral fixture (NOT app source). src/lib/eslint-rules.test.ts lints
// this file and asserts the raw toLocaleString below triggers
// `no-restricted-syntax` at severity 1 (WARN).
export function emitToLocale(): string {
  return new Date().toLocaleString();
}
