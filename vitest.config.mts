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
//
// DECISION Phase 88 plan 06: the plugin is pointed at `tsconfig.vitest.json`
// (which extends the root config and widens `include` to `.js`/`.jsx`) rather
// than left to crawl for `tsconfig.json`. The plugin refuses to resolve `@/`
// imports whose IMPORTER is outside the tsconfig `include` globs, and the root
// config lists only `.ts`/`.tsx` — so a `.tsx` test rendering a `.js` component
// that imports through `@/` fails at import-analysis. Widening the ROOT config
// instead would feed JSX-in-`.js` files to `tsc --noEmit` and break
// `npm run typecheck`; hand-writing the alias into `resolve.alias` is forbidden
// above. Removing the `projects` argument re-breaks the `.js`-under-`.tsx-test`
// pattern this whole config exists to support — that is a decision, not a cleanup.
export default defineConfig({
  // `jsxInJs` must precede react()/oxc so JSX-in-`.js` is desugared first.
  plugins: [jsxInJs, tsconfigPaths({ projects: ['tsconfig.vitest.json'] }), react()],
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
