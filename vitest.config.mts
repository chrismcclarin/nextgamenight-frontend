import { defineConfig } from 'vitest/config';
import { transformWithOxc, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

// The app is mid JS->TS migration, so many components (e.g. HeatmapTooltip.js)
// are `.js` files that contain JSX. Vite 8's default transform is oxc, which
// derives the parser language from the file extension — `.js` is parsed as plain
// JS and chokes on JSX ("JSX syntax is disabled"). The core `vite:oxc` plugin
// excludes `.js` and exposes no per-file `lang` override in static config. This
// `enforce: 'pre'` plugin transforms our source `.js`/`.jsx` files with oxc using
// an explicit `lang: 'jsx'` BEFORE the core transform, so `.tsx` tests (and the
// 84-10 grid-convergence tests) can import the `.js` components.
const jsxInJs: Plugin = {
  name: 'jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    const [path] = id.split('?');
    if (!/\.jsx?$/.test(path) || path.includes('/node_modules/')) return null;
    if (!/<[A-Za-z>]/.test(code)) return null; // skip plain JS with no JSX
    const result = await transformWithOxc(code, path, {
      lang: 'jsx',
      jsx: { runtime: 'automatic', importSource: 'react' },
    } as never);
    return { code: result.code, map: result.map };
  },
};

// 82-RESEARCH.md Pattern 5. vite-tsconfig-paths bridges the `@/*` alias from
// tsconfig.json (Don't-Hand-Roll: never duplicate the alias map in resolve.alias).
// The next/font/google alias (Pitfall 4) is the ONE explicit alias we keep — it
// stubs the font loader so component tests in later phases don't crash on import.
export default defineConfig({
  // `jsxInJs` must precede react()/oxc so JSX-in-`.js` is desugared first.
  plugins: [jsxInJs, tsconfigPaths(), react()],
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
