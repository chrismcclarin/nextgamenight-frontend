// Registers the @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// on Vitest's `expect`. Loaded via vitest.config.mts `setupFiles`.
import '@testing-library/jest-dom/vitest';

// Registers the vitest-axe a11y matcher (toHaveNoViolations) on Vitest's
// `expect`, so Phase-84 Modal/primitive tests can assert axe-clean rendering.
import { expect } from 'vitest';
import { toHaveNoViolations } from 'vitest-axe/matchers';

expect.extend({ toHaveNoViolations });
