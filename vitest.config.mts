import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

// 82-RESEARCH.md Pattern 5. vite-tsconfig-paths bridges the `@/*` alias from
// tsconfig.json (Don't-Hand-Roll: never duplicate the alias map in resolve.alias).
// The next/font/google alias (Pitfall 4) is the ONE explicit alias we keep — it
// stubs the font loader so component tests in later phases don't crash on import.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      'next/font/google': fileURLToPath(
        new URL('./__mocks__/nextFontMock.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests use the `.test.ts(x)` suffix under src/. Playwright owns the
    // `e2e/*.spec.ts` files — exclude them so `vitest run` doesn't try to
    // collect Playwright's `test()` (which throws outside the PW runner).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
