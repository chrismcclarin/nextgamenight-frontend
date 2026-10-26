// @vitest-environment node
//
// Pins src/test-utils/scrubSessionHeaders.ts, the scrub e2e/support/scrubbedFetch.ts applies to
// every Playwright route.fetch error (R8). Node environment, because T1 drives the installed
// Playwright's real request client. Comments here are line comments only (CF-9), and no test
// title names the session cookie: titles reach the CI log a later log grep reads.
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
import { request } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { SCRUBBED, scrubError, scrubSessionHeaders } from './scrubSessionHeaders';

const ESC = '\u001b';
const PLANTS = ['PLANT-COOKIE-ONE', 'PLANT-COOKIE-TWO', 'PLANT-BEARER'];

// The census arm's two call shapes. A Route call under any binding name, and an
// APIRequestContext verb call: the request fixture, page.request, context.request, or a
// request.newContext() result named ...Context. Playwright prints the same request headers for
// the second shape, prefixed apiRequestContext. A context under any other name is read from its
// source (CONTEXT_SOURCE_RES below).
const ROUTE_FETCH_RE = /\.fetch\s*\(/;
const REQUEST_VERB_RE = /\b(request|page\.request|context\.request|\w+Context)\s*\.\s*(get|post|put|patch|delete|head|fetch)\s*\(/;
const HELPER = 'e2e/support/scrubbedFetch.ts';

// A comment line: with every closed block-comment span removed, it is empty or starts with a
// line-comment, block-comment or star leader.
function isCommentLine(line: string): boolean {
  const rest = line.replace(/\/\*.*?\*\//g, '').trim();
  return rest === '' || rest.startsWith('//') || rest.startsWith('*') || rest.startsWith('/*');
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Code review C-WR-01: the verb arm reads a receiver's NAME, so the census also reads where an
// APIRequestContext comes from. Three sources, each capturing the bound name when there is one:
// request.newContext (on the fixture or on playwright.request); a rename of the request fixture
// in a destructuring pattern (a lowercase target, so a type annotation such as
// request: APIRequestContext is not one); and an alias of a .request property (page.request,
// context.request, playwright.request), never a call such as route.request(). Outside
// e2e/support/ a source line is itself an offender; in every file a verb call on a captured
// name is one.
const CONTEXT_SOURCE_RES = [
  /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?)?(?:[\w$]+\s*\.\s*)*\brequest\s*\.\s*newContext\s*\(/,
  /[{,]\s*request\s*:\s*([a-z_$][\w$]*)/,
  /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*)?=\s*(?:[\w$]+\s*\.\s*)+request\b(?!\s*[.(\w$])/,
];
const VERB_CALL = '\\s*\\.\\s*(?:get|post|put|patch|delete|head|fetch)\\s*\\(';

function callLinesIn(text: string, rel: string): number[] {
  const lines = text.split('\n');
  const code = lines.map((line) => !isCommentLine(line));
  const names = new Set<string>();
  const source = lines.map((line, i) => {
    if (!code[i]) return false;
    let hit = false;
    for (const re of CONTEXT_SOURCE_RES) {
      const m = re.exec(line);
      if (m) {
        hit = true;
        if (m[1]) names.add(m[1]);
      }
    }
    return hit;
  });
  const bound =
    names.size > 0
      ? new RegExp(`(?<![\\w$.])(?:${[...names].map((n) => n.replace(/\$/g, '\\$')).join('|')})${VERB_CALL}`)
      : null;
  const flagSources = !rel.startsWith('e2e/support/');
  return lines.flatMap((line, i) =>
    code[i] &&
    (ROUTE_FETCH_RE.test(line) || REQUEST_VERB_RE.test(line) || bound?.test(line) || (flagSources && source[i]))
      ? [i + 1]
      : [],
  );
}

function callLines(root: string, rel: string): number[] {
  return callLinesIn(readFileSync(join(root, rel), 'utf8'), rel);
}

// A local port that was open a moment ago and is closed now, so a request to it is refused.
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

describe('scrubSessionHeaders and scrubError', () => {
  it('T1 live: a real Playwright request failure keeps its diagnosis and loses the session headers', async () => {
    const port = await closedPort();
    expect(port).toBeGreaterThan(0);
    const context = await request.newContext();
    let raw: unknown;
    try {
      await context.get(`http://127.0.0.1:${port}/plant`, {
        timeout: 5000,
        headers: {
          cookie: 'zzPlant.0=PLANT-COOKIE-ONE; zzPlant.1=PLANT-COOKIE-TWO',
          Authorization: 'Bearer PLANT-BEARER',
        },
      });
    } catch (error) {
      raw = error;
    } finally {
      await context.dispose();
    }
    const formatMoved =
      'Playwright no longer prints request headers in its call log; re-check scrubSessionHeaders against the new format';
    expect(raw, formatMoved).toBeInstanceOf(Error);
    const message = (raw as Error).message;
    expect(message.includes('PLANT-COOKIE-ONE') && message.includes('PLANT-BEARER'), formatMoved).toBe(true);

    const scrubbedText = scrubSessionHeaders(message);
    const scrubbed = scrubError(raw);
    for (const text of [scrubbedText, scrubbed.message, scrubbed.stack ?? '']) {
      for (const plant of PLANTS) expect(text).not.toContain(plant);
      expect(text).toContain(SCRUBBED);
      expect(text).toContain('ECONNREFUSED');
      expect(text).toContain('user-agent:');
    }
  }, 30000);

  it('T2: every case of the four session header names scrubs to the measured call-log shape', () => {
    const names = [
      'cookie', 'Cookie', 'COOKIE',
      'authorization', 'Authorization', 'AUTHORIZATION',
      'set-cookie', 'Set-Cookie', 'SET-COOKIE',
      'proxy-authorization', 'Proxy-Authorization', 'PROXY-AUTHORIZATION',
    ];
    for (const name of names) {
      const line = `${ESC}[2m    - ${name}: secret-${name}=v1; other=v2${ESC}[22m`;
      expect(scrubSessionHeaders(line)).toBe(`${ESC}[2m    - ${name}: ${SCRUBBED}${ESC}[22m`);
    }
    const keep = [
      `${ESC}[2m    - user-agent: Playwright/1.60.0 (x64; macOS 12.6) node/24.0${ESC}[22m`,
      `${ESC}[2m    - x-cookie-policy: strict; max=3${ESC}[22m`,
      `${ESC}[2m    - accept-encoding: gzip,deflate,br${ESC}[22m`,
    ];
    for (const line of keep) expect(scrubSessionHeaders(line)).toBe(line);
    const block = [keep[0], `${ESC}[2m    - Cookie: a=1; b=2${ESC}[22m`, keep[1]].join('\n');
    expect(scrubSessionHeaders(block)).toBe([keep[0], `${ESC}[2m    - Cookie: ${SCRUBBED}${ESC}[22m`, keep[1]].join('\n'));
    // A quoted JSON key keeps its quote and loses everything after the colon.
    expect(scrubSessionHeaders('{"authorization": "Bearer abc", "x": 1}')).toBe(`{"authorization": ${SCRUBBED}`);
    // Code review C-IN-01: a header map serialized twice (or more) escapes the key's closing
    // quote, and the escaped key is a header line too.
    const twice = JSON.stringify({ msg: JSON.stringify({ headers: { authorization: 'Bearer SECRET1', cookie: 'sid=SECRET2' } }) });
    expect(scrubSessionHeaders(twice)).toBe(`{"msg":"{\\"headers\\":{\\"authorization\\": ${SCRUBBED}`);
    const thrice = JSON.stringify({ outer: twice });
    expect(scrubSessionHeaders(thrice)).not.toMatch(/SECRET1|SECRET2/);
  });

  it('T3: session cookie pairs outside any header line leave no trace of the cookie name', () => {
    const prose = 'the jar held appSession.0=eyJhbGciOiJkaXIi.part0; appSession.1=part1..tail and more';
    const json = JSON.stringify({ jar: 'APPSESSION=eyJhbGciOiJkaXIi.whole', other: 'kept' });
    for (const text of [prose, json]) {
      const out = scrubSessionHeaders(text);
      expect(out).not.toMatch(/appsession/i);
      expect(out).not.toContain('eyJhbGciOiJkaXIi');
      expect(out).toContain(SCRUBBED);
    }
    expect(scrubSessionHeaders(prose)).toBe(`the jar held ${SCRUBBED}; ${SCRUBBED} and more`);
    expect(scrubSessionHeaders(json)).toBe(`{"jar":"${SCRUBBED}","other":"kept"}`);
  });

  it('T4: scrubError returns a fresh Error carrying only the scrubbed message, the name and the scrubbed stack', () => {
    const original = new Error('route.fetch: boom\n    - cookie: secret-one');
    original.name = 'TimeoutError';
    Object.assign(original, { cause: new Error('inner secret-two'), extra: 'secret-three' });
    const out = scrubError(original);
    expect(out).not.toBe(original);
    expect(out).toBeInstanceOf(Error);
    expect('cause' in out).toBe(false);
    expect(Object.getOwnPropertyNames(out).every((n) => ['message', 'stack', 'name'].includes(n))).toBe(true);
    expect(out.name).toBe('TimeoutError');
    expect(out.message).toBe(`route.fetch: boom\n    - cookie: ${SCRUBBED}`);
    expect(out.stack ?? '').not.toContain('secret-one');
    expect(JSON.stringify(Object.getOwnPropertyNames(out).map((n) => String(Reflect.get(out, n))))).not.toMatch(/secret-(two|three)/);

    const fromText = scrubError('thrown text appSession=abc; tail');
    expect(fromText).toBeInstanceOf(Error);
    expect(fromText.message).toBe(`thrown text ${SCRUBBED}; tail`);
  });

  it('every Playwright route.fetch in e2e/ goes through e2e/support/scrubbedFetch.ts', () => {
    const root = process.cwd();
    const files = tsFilesUnder(join(root, 'e2e')).map((abs) => relative(root, abs).split('\\').join('/'));
    // Non-vacuous: the walk saw the e2e tree, and the helper still holds its one call.
    expect(files.length).toBeGreaterThanOrEqual(70);
    expect(files).toContain(HELPER);
    expect(callLines(root, HELPER)).toHaveLength(1);
    const offenders = files
      .filter((rel) => rel !== HELPER)
      .flatMap((rel) => callLines(root, rel).map((n) => `${rel}:${n}`));
    expect(
      offenders,
      'route a Route call through scrubbedFetch (e2e/support/scrubbedFetch.ts), and an APIRequestContext call ' +
        'through a scrubbed wrapper added under e2e/support/ (0 such calls at FE 995023d): ' +
        offenders.join(', '),
    ).toEqual([]);
  });

  // Code review C-WR-01: the verb arm alone names a context by its receiver, so a context made
  // by request.newContext, a renamed request fixture, or an alias of page.request went unseen.
  it('the census also flags an APIRequestContext reached under another name, at its source and at its calls', () => {
    const probe = [
      "const api = await request.newContext({ storageState: 'e2e/.auth/user.json' });",
      "const res = await api.get('/api/users/me');",
      "test('x', async ({ request: http }) => { await http.post('/api/feedback'); });",
      "const ctx = page.request; await ctx.delete('/api/x');",
    ];
    expect(callLinesIn(probe.join('\n'), 'e2e/probe.spec.ts')).toEqual([1, 2, 3, 4]);
    // Each source line is flagged on its own, without the call that follows it.
    expect(callLinesIn(probe[0], 'e2e/probe.spec.ts')).toEqual([1]);
    expect(callLinesIn("test('x', async ({ request: http }) => {});", 'e2e/probe.spec.ts')).toEqual([1]);
    expect(callLinesIn('const ctx = page.request;', 'e2e/probe.spec.ts')).toEqual([1]);
    expect(callLinesIn('const api = playwright.request;', 'e2e/probe.spec.ts')).toEqual([1]);
    // Not contexts: a route's Request, its method read, and a type annotation on the fixture.
    const notContexts = [
      'const request = route.request();',
      "if (route.request().method() !== 'GET') {",
      'async function f({ request }: { request: APIRequestContext }) {}',
    ];
    expect(callLinesIn(notContexts.join('\n'), 'e2e/probe.spec.ts')).toEqual([]);
    // A scrubbed wrapper under e2e/support/ may create the context; its verb calls stay flagged
    // until the census names that wrapper beside the helper.
    expect(callLinesIn(probe.slice(0, 2).join('\n'), 'e2e/support/apiWrapper.ts')).toEqual([2]);
  });
});
