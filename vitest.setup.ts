// Registers the @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// on Vitest's `expect`. Loaded via vitest.config.mts `setupFiles`.
import '@testing-library/jest-dom/vitest';

// Registers the vitest-axe a11y matcher (toHaveNoViolations) on Vitest's
// `expect`, so Phase-84 Modal/primitive tests can assert axe-clean rendering.
// `vitest-axe/extend-expect` is types-only (its dist runtime file is empty), so
// it augments the `Assertion` interface but does NOT register the matcher — the
// runtime registration is done explicitly below. We import the matchers as a
// namespace because the package re-exports `toHaveNoViolations` as a TYPE in its
// .d.ts (a packaging quirk); the namespace carries the real runtime function
// without forcing us to reference the type-only name as a value.
import { expect } from 'vitest';
import 'vitest-axe/extend-expect';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);
