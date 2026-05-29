#!/usr/bin/env node
/**
 * generate-ai-map.mjs
 *
 * Walks the Next.js frontend at periodictabletop/src/ and emits a condensed
 * project map to .ai-context/project-map.md (repo root).
 *
 * The output is intended for AI consumption — high signal density, no
 * implementation detail. Run before architectural questions, feature
 * starts, or whenever the map appears stale.
 *
 * Regenerate via:   npm run generate-ai-map   (from periodictabletop/)
 * Or directly:      node scripts/generate-ai-map.mjs
 *
 * Parses with regex (not a full AST) — fragile by design. If extraction
 * misses something, harden the relevant matcher; don't reach for Babel
 * unless we hit a real wall.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve paths relative to script location so it works regardless of cwd.
const FRONTEND_ROOT = path.resolve(__dirname, '..');          // periodictabletop/
const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..');           // repo root
const SRC_DIR = path.join(FRONTEND_ROOT, 'src');
const APP_DIR = path.join(SRC_DIR, 'app');
const LIB_API = path.join(SRC_DIR, 'lib', 'api.js');
const OUTPUT_DIR = path.join(REPO_ROOT, '.ai-context');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'project-map.md');

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (/\.(jsx?|tsx?|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const relSrc = (p) => path.relative(SRC_DIR, p).replace(/\\/g, '/');
const relRoot = (p) => path.relative(REPO_ROOT, p).replace(/\\/g, '/');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function lineCount(source) {
  return source.split('\n').length;
}

// ──────────────────────────────────────────────────────────────────────────
// Routes — every page.js under src/app/ becomes a route
// ──────────────────────────────────────────────────────────────────────────

function extractRoutes(allFiles) {
  const routes = [];
  for (const file of allFiles) {
    const relApp = path.relative(APP_DIR, file).replace(/\\/g, '/');
    if (!relApp.endsWith('page.js') && !relApp.endsWith('page.jsx') && !relApp.endsWith('page.tsx')) continue;
    if (relApp.startsWith('..')) continue;

    const segments = relApp.split('/').slice(0, -1);
    // Route groups in (parens) don't appear in the URL.
    const urlSegments = segments.filter((s) => !s.startsWith('('));
    const urlPath = urlSegments.length === 0 ? '/' : '/' + urlSegments.join('/');

    const source = read(file);
    const lines = lineCount(source);

    // Component name: try `function Foo(` or `export default function Foo(` or `export default Foo`.
    const m =
      source.match(/export\s+default\s+function\s+(\w+)/) ||
      source.match(/function\s+(\w+)\s*\(/) ||
      source.match(/export\s+default\s+(\w+)\s*;/) ||
      source.match(/const\s+(\w+)\s*=\s*\(/);
    const component = m ? m[1] : 'unknown';

    const usesAuth0 = /useUser\s*\(/.test(source) || /withPageAuthRequired/.test(source);
    const isClient = /['\"]use client['\"]/.test(source);

    routes.push({
      urlPath,
      file: relSrc(file),
      component,
      auth: usesAuth0 ? 'auth' : 'public',
      kind: isClient ? 'client' : 'server',
      loc: lines,
    });
  }
  return routes.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

// ──────────────────────────────────────────────────────────────────────────
// Providers — files that call createContext and export a Provider
// ──────────────────────────────────────────────────────────────────────────

function extractProviders(allFiles) {
  const providers = [];
  for (const file of allFiles) {
    const source = read(file);
    if (!/createContext\s*\(/.test(source)) continue;

    // Try to find a *Provider function name.
    const m =
      source.match(/export\s+function\s+(\w*Provider)\s*\(/) ||
      source.match(/export\s+default\s+function\s+(\w*Provider)\s*\(/) ||
      source.match(/function\s+(\w*Provider)\s*\(/);
    if (!m) continue;
    const name = m[1];

    // Find the convenience hook (use{Something}) — usually exported nearby.
    const hookMatch =
      source.match(/export\s+function\s+(use\w+)/) ||
      source.match(/export\s+const\s+(use\w+)\s*=/);
    const hook = hookMatch ? hookMatch[1] : null;

    // Find provider value — two shapes supported:
    //   1. inline:    <Ctx.Provider value={{ a, b: x, ... }}>
    //   2. variable:  <Ctx.Provider value={contextValue}> + earlier `const contextValue = { ... }` or `useMemo(() => ({ ... }))`
    let exports = [];
    const inlineMatch = source.match(/value=\{\{([\s\S]*?)\}\}/);
    let body = null;
    if (inlineMatch) {
      body = inlineMatch[1];
    } else {
      const varMatch = source.match(/value=\{(\w+)\}/);
      if (varMatch) {
        const varName = varMatch[1];
        // Try `const varName = { ... };` then `const varName = useMemo(() => ({ ... }), [...])`.
        const declObj = source.match(new RegExp(`const\\s+${varName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`));
        const declMemo = source.match(new RegExp(`const\\s+${varName}\\s*=\\s*useMemo\\s*\\(\\s*\\(\\)\\s*=>\\s*\\(\\{([\\s\\S]*?)\\}\\)\\s*,`));
        body = (declObj && declObj[1]) || (declMemo && declMemo[1]) || null;
      }
    }
    if (body) {
      const keys = new Set();
      // Match keys: `foo,` (shorthand) or `foo:` (aliased) at start of a logical entry.
      const keyRegex = /(?:^|[\n,])\s*(\w+)\s*[,:}]/g;
      let km;
      while ((km = keyRegex.exec(body)) !== null) {
        const k = km[1];
        if (k && !['true', 'false', 'null', 'undefined'].includes(k)) keys.add(k);
      }
      exports = [...keys];
    }

    providers.push({ name, hook, file: relSrc(file), exports });
  }
  return providers;
}

function findProviderConsumers(allFiles, providers) {
  const consumers = Object.create(null);
  for (const p of providers) consumers[p.name] = new Set();

  for (const file of allFiles) {
    const source = read(file);
    for (const p of providers) {
      if (relSrc(file) === p.file) continue;
      // Match the hook name OR a direct `useContext(SomethingContext)` reference.
      const ctxName = p.name.replace(/Provider$/, 'Context');
      const hookHit = p.hook && new RegExp(`\\b${p.hook}\\s*\\(`).test(source);
      const ctxHit = new RegExp(`\\b${ctxName}\\b`).test(source);
      if (hookHit || ctxHit) consumers[p.name].add(relSrc(file));
    }
  }

  const out = {};
  for (const [k, v] of Object.entries(consumers)) out[k] = [...v].sort();
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// API Client — parse lib/api.js for namespace + function + method + endpoint
// ──────────────────────────────────────────────────────────────────────────

function extractApiClient() {
  if (!fs.existsSync(LIB_API)) return [];
  const source = read(LIB_API);
  const namespaces = [];

  // Capture `export const fooAPI = { ... };` blocks. Requires the closing `};`
  // to live on its own line at column 0 — true for the current api.js style.
  const nsRegex = /export\s+const\s+(\w+API)\s*=\s*\{([\s\S]*?)\n\};/g;
  let m;
  while ((m = nsRegex.exec(source)) !== null) {
    const name = m[1];
    const body = m[2];
    const functions = parseApiFunctions(body);
    namespaces.push({ name, functions });
  }
  return namespaces;
}

function parseApiFunctions(body) {
  // Each function in an API namespace looks like:
  //   getThing: (args) => apiFetch(`/path`, { method: 'POST', ... }),
  // or method shorthand:
  //   getThing(args) { ... },
  //
  // Strategy: lock onto the indent of the FIRST top-level key, then only
  // emit keys at that exact indent. Skips nested options (method:, body:)
  // and inner function calls (apiFetch, fetch).
  const funcs = [];
  const seen = new Set();
  const lines = body.split('\n');

  // Reserved names that surface as false positives — known internal helpers
  // or option-object keys at namespace-level indent we don't want emitted.
  const SKIP_NAMES = new Set([
    'apiFetch', 'fetch', 'method', 'body', 'headers', 'credentials',
    'mode', 'cache', 'signal', 'redirect', 'referrer', 'integrity',
    'if', 'return', 'const', 'let', 'var', 'else', 'try', 'catch', 'throw',
    'await', 'async', 'new',
  ]);

  let baseIndent = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    const indentLen = line.match(/^(\s*)/)[1].length;
    const keyMatch = line.match(/^\s*(?:async\s+)?(\w+)\s*[(:]/);
    if (!keyMatch) continue;
    const name = keyMatch[1];
    if (SKIP_NAMES.has(name)) continue;

    // Lock baseIndent to the first valid key we find.
    if (baseIndent === null) baseIndent = indentLen;
    if (indentLen !== baseIndent) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    // Find the apiFetch call to extract endpoint + method.
    const lookahead = lines.slice(i, i + 8).join('\n');
    const fetchMatch = lookahead.match(/apiFetch\s*\(\s*[`'"]([^`'"]*)[`'"]\s*(?:,\s*\{([\s\S]*?)\})?/);
    let endpoint = null;
    let method = 'GET';
    if (fetchMatch) {
      endpoint = fetchMatch[1];
      const opts = fetchMatch[2] || '';
      const methodMatch = opts.match(/method:\s*['"](\w+)['"]/);
      if (methodMatch) method = methodMatch[1];
    }
    funcs.push({ name, method, endpoint });
  }
  return funcs;
}

// ──────────────────────────────────────────────────────────────────────────
// Components — files under src/app/components/, ranked by import count
// ──────────────────────────────────────────────────────────────────────────

function analyzeComponents(allFiles) {
  const componentsDir = path.join(APP_DIR, 'components');
  if (!fs.existsSync(componentsDir)) return [];

  const components = new Map(); // name → { file, importCount }
  function walkComponents(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkComponents(full);
      } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        // Filter out data/util modules — must contain a JSX return to count as a component.
        const src = read(full);
        if (!/return\s*[(<]/.test(src)) continue;
        const name = entry.name.replace(/\.(jsx?|tsx?)$/, '');
        components.set(name, { file: relSrc(full), importCount: 0 });
      }
    }
  }
  walkComponents(componentsDir);

  // Count imports of each component across all source files.
  for (const file of allFiles) {
    const source = read(file);
    for (const [name] of components) {
      // Match `from './X'`, `from '../X'`, `from '@/components/X'`, etc.
      // Avoid false positives: require the name to appear as a path segment.
      const re = new RegExp(`from\\s+['"][^'"]*?\\/${name}(?:['"]|\\/['"])`, 'g');
      if (re.test(source)) {
        components.get(name).importCount++;
      }
    }
  }

  return [...components.entries()]
    .map(([name, info]) => ({ name, ...info }))
    .filter((c) => c.importCount > 0)
    .sort((a, b) => b.importCount - a.importCount);
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

function generate() {
  const allFiles = walk(SRC_DIR);
  const routes = extractRoutes(allFiles);
  const providers = extractProviders(allFiles);
  const consumers = findProviderConsumers(allFiles, providers);
  const apiNamespaces = extractApiClient();
  const components = analyzeComponents(allFiles);

  const now = new Date().toISOString().slice(0, 10);
  const out = [];

  out.push('# Frontend Project Map');
  out.push('');
  out.push(`> Auto-generated by \`periodictabletop/scripts/generate-ai-map.mjs\` on ${now}.`);
  out.push('> **DO NOT EDIT BY HAND** — regenerate via `npm run generate-ai-map` (from `periodictabletop/`).');
  out.push('>');
  out.push('> If this file references symbols that no longer exist or omits recently-added routes, it is stale. Regenerate before trusting it.');
  out.push('');

  // Routes
  out.push('## Routes');
  out.push('');
  out.push(`${routes.length} routes total.`);
  out.push('');
  out.push('| URL | Component | File | Auth | Kind | LOC |');
  out.push('|---|---|---|---|---|---:|');
  for (const r of routes) {
    out.push(`| \`${r.urlPath}\` | \`${r.component}\` | \`${r.file}\` | ${r.auth} | ${r.kind} | ${r.loc} |`);
  }
  out.push('');

  // Providers
  out.push('## Context Providers');
  out.push('');
  out.push(`${providers.length} providers mounted in the provider tower (see \`src/app/layout.js\`).`);
  out.push('');
  for (const p of providers) {
    out.push(`### ${p.name}`);
    out.push(`- **File:** \`${p.file}\``);
    if (p.hook) out.push(`- **Hook:** \`${p.hook}()\``);
    out.push(`- **Exports:** ${p.exports.length ? p.exports.map((e) => `\`${e}\``).join(', ') : '_(none detected — regex may have missed)_'}`);
    const cs = consumers[p.name] || [];
    out.push(`- **Consumers (${cs.length}):** ${cs.length ? cs.map((c) => `\`${c}\``).join(', ') : '_(none detected)_'}`);
    out.push('');
  }

  // API Client
  out.push('## API Client (`lib/api.js`)');
  out.push('');
  out.push(`${apiNamespaces.length} namespaces. Method + endpoint extracted where possible.`);
  out.push('');
  for (const ns of apiNamespaces) {
    out.push(`### \`${ns.name}\``);
    if (ns.functions.length === 0) {
      out.push('_(no functions detected — regex may have missed)_');
    } else {
      for (const fn of ns.functions) {
        const ep = fn.endpoint ? ` → \`${fn.method} ${fn.endpoint}\`` : '';
        out.push(`- \`${fn.name}()\`${ep}`);
      }
    }
    out.push('');
  }

  // Components
  out.push('## Component Inventory');
  out.push('');
  out.push(`${components.length} components with at least one import. Sorted by reuse — top items are likely primitives, bottom items are single-use.`);
  out.push('');
  out.push('| Component | Imported by | Reuse | File |');
  out.push('|---|---:|---|---|');
  for (const c of components) {
    const marker = c.importCount >= 5 ? 'high' : c.importCount >= 3 ? 'medium' : c.importCount >= 2 ? 'shared' : 'single';
    out.push(`| \`${c.name}\` | ${c.importCount} | ${marker} | \`${c.file}\` |`);
  }
  out.push('');

  // Stats
  out.push('## Stats');
  out.push('');
  out.push(`- Source files scanned: ${allFiles.length}`);
  out.push(`- Routes: ${routes.length}`);
  out.push(`- Providers: ${providers.length}`);
  out.push(`- API namespaces: ${apiNamespaces.length}`);
  out.push(`- API functions: ${apiNamespaces.reduce((s, ns) => s + ns.functions.length, 0)}`);
  out.push(`- Components: ${components.length}`);
  out.push('');

  const text = out.join('\n') + '\n';
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, text);

  const bytes = Buffer.byteLength(text, 'utf8');
  console.log(`✓ Wrote ${relRoot(OUTPUT_FILE)}`);
  console.log(`  ${bytes.toLocaleString()} bytes (~${Math.round(bytes / 4).toLocaleString()} tokens)`);
  console.log(`  ${routes.length} routes, ${providers.length} providers, ${apiNamespaces.length} API namespaces, ${components.length} components`);
}

generate();
