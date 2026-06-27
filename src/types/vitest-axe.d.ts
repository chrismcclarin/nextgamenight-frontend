// vitest-axe ships its matcher augmentation against the legacy global
// `Vi.Assertion` namespace, which Vitest 4 no longer reads (it resolves custom
// matchers from the `vitest` module, the same way @testing-library/jest-dom
// does). Re-augment the `vitest` module so `expect(results).toHaveNoViolations()`
// type-checks. The runtime matcher is registered in `vitest.setup.ts`.
import type { AxeMatchers } from 'vitest-axe/matchers';

// The `<T = any>` signature must match Vitest's own `Assertion<T>` declaration
// so this augmentation merges into it rather than creating a conflicting one.
declare module 'vitest' {
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
