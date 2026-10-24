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
// the second shape, prefixed apiRequestContext.
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

function callLines(file: string): number[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) =>
      !isCommentLine(line) && (ROUTE_FETCH_RE.test(line) || REQUEST_VERB_RE.test(line)) ? [i + 1] : [],
    );
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
    expect(callLines(join(root, HELPER))).toHaveLength(1);
    const offenders = files
      .filter((rel) => rel !== HELPER)
      .flatMap((rel) => callLines(join(root, rel)).map((n) => `${rel}:${n}`));
    expect(
      offenders,
      'route a Route call through scrubbedFetch (e2e/support/scrubbedFetch.ts), and an APIRequestContext call ' +
        'through a scrubbed wrapper added under e2e/support/ (0 such calls at FE 995023d): ' +
        offenders.join(', '),
    ).toEqual([]);
  });
});
