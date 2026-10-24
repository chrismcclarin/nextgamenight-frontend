#!/usr/bin/env node
// encrypt-evidence.test.mjs — Phase 88.6.2 plan 27, SPEC prohibition P3 ("P3 MUST NOT place private
// key material in any repo or secret, or print decrypted evidence in CI").
//
// WHAT. The mechanical half of P3 for the CI evidence key. The recipient file the encrypt steps use
// must hold one age1 PUBLIC key and no private key material, and no tracked file in this repo may
// hold an age identity. Every recipient check runs scripts/encrypt-evidence.sh --check-recipients,
// the same check each CI encrypt step runs before it packs anything.
//
// USAGE
//   node --test --test-reporter=tap scripts/encrypt-evidence.test.mjs                 default mode
//   GSD_PROHIB_SUBJECT=path/to/file node --test --test-reporter=tap scripts/encrypt-evidence.test.mjs
//
// MODES
//   Default (GSD_PROHIB_SUBJECT unset): exactly 4 tests. The committed .github/evidence-recipient.txt
//   passes; the violation fixture scripts/fixtures/evidence-recipient/secret.txt is refused with
//   PROBLEM private-key and its line is never echoed; the clean fixture public.txt passes; and no
//   tracked file in the FE repo holds an age identity (git grep must exit 1 with empty output; any
//   other status fails, so a broken git never reads as clean).
//   Subject (GSD_PROHIB_SUBJECT set, resolved against the cwd): exactly 2 tests over that file. This
//   is the subject-injection convention of the verifier's prohibition producer, which runs it red on
//   secret.txt (the first test passes, the second fails) and green on public.txt.
//
// EXIT CODES: 0 when every test of the mode passed and exactly the mode's count ran; 1 otherwise (a
// VACUITY line on stderr names both numbers when the count is off).
//
// Node builtins only, Node 20 safe. Plain line comments only (CF-9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCRIPT = path.join(FE_ROOT, 'scripts', 'encrypt-evidence.sh');
export const RECIPIENT_FILE = path.join(FE_ROOT, '.github', 'evidence-recipient.txt');
export const FIXTURES = path.join(FE_ROOT, 'scripts', 'fixtures', 'evidence-recipient');
// An age identity line: the classic and the post-quantum form, matched case-insensitively.
export const IDENTITY_RE = 'AGE-SECRET-KEY-(PQ-)?1[02-9AC-HJ-NP-Z]{58}';
export const RECIPIENT_LINE_RE = /^age1[02-9ac-hj-np-z]{58}$/;
export const DEFAULT_TEST_COUNT = 4;
export const SUBJECT_TEST_COUNT = 2;

// Run the recipients check on one file; returns { status, out } with stdout and stderr joined.
export function checkRecipients(file) {
  const r = spawnSync('bash', [SCRIPT, '--check-recipients', file], { encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function lastLine(out) {
  const lines = out.split('\n').filter((l) => l !== '');
  return lines[lines.length - 1];
}

let ran = 0;
const subject = process.env.GSD_PROHIB_SUBJECT;
const expected = subject !== undefined ? SUBJECT_TEST_COUNT : DEFAULT_TEST_COUNT;

process.on('exit', () => {
  if (ran !== expected) {
    process.exitCode = 1;
    console.error(`VACUITY ran ${ran} expected ${expected}`);
  }
});

if (subject !== undefined) {
  const subjectPath = path.resolve(process.cwd(), subject);

  test('subject holds an age1 recipient line', () => {
    ran++;
    const { out } = checkRecipients(subjectPath);
    for (const kind of ['missing-file', 'no-recipient', 'malformed-recipient', 'extra-line']) {
      assert.ok(!out.includes(`PROBLEM ${kind}`), `PROBLEM ${kind} for ${subjectPath}`);
    }
    const lines = fs.readFileSync(subjectPath, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
    assert.equal(lines.filter((l) => RECIPIENT_LINE_RE.test(l)).length, 1, `no single age1 line in ${subjectPath}`);
  });

  test('subject holds no private key material', () => {
    ran++;
    const { status, out } = checkRecipients(subjectPath);
    assert.ok(!out.includes('PROBLEM private-key'), `private key material in ${subjectPath}`);
    assert.equal(status, 0, `the recipients check failed on ${subjectPath}`);
    assert.equal(lastLine(out), 'recipients: OK');
  });
} else {
  test('the committed .github/evidence-recipient.txt passes the recipients check', () => {
    ran++;
    const { status, out } = checkRecipients(RECIPIENT_FILE);
    assert.equal(status, 0, `recipients check failed:\n${out}`);
    assert.equal(lastLine(out), 'recipients: OK');
  });

  test('secret.txt is refused with PROBLEM private-key and its line is never echoed', () => {
    ran++;
    const { status, out } = checkRecipients(path.join(FIXTURES, 'secret.txt'));
    assert.equal(status, 1);
    assert.ok(out.includes('PROBLEM private-key'), out);
    assert.ok(!out.includes('FIXTURE ONLY'), 'the check echoed the line it refused');
    assert.equal(lastLine(out), 'recipients: FAIL');
  });

  test('public.txt passes the recipients check', () => {
    ran++;
    const { status, out } = checkRecipients(path.join(FIXTURES, 'public.txt'));
    assert.equal(status, 0, out);
    assert.equal(lastLine(out), 'recipients: OK');
  });

  test('no tracked file in the FE repo holds an age identity', () => {
    ran++;
    const r = spawnSync('git', ['-C', FE_ROOT, 'grep', '-IiEl', IDENTITY_RE], { encoding: 'utf8' });
    if (r.error) throw r.error;
    assert.equal(r.status, 1, `git grep exited ${r.status} (0 = a tracked file matches, other = git failed):\n${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '');
  });
}
