#!/usr/bin/env bash
# encrypt-evidence.sh — Phase 88.6.2 plan 27 (SPEC R7, register row T-88.6-G34).
#
# WHAT. Packs CI evidence directories into ONE age-encrypted tar file, enc/<name>/<name>.tar.age,
# encrypted to the public recipient in a committed file (.github/evidence-recipient.txt in CI).
# Both e2e artifact uploads in .github/workflows/ci.yml run this script in the step directly before
# them and upload only enc/<name>/, so a rendered page of the authenticated E2E account (a failure
# screenshot, an HTML report, DOM text) leaves this PUBLIC repo only as age ciphertext.
#
# WHY. Anyone signed in to GitHub can download an artifact of a public repo for its retention
# window. The phone project is authenticated, so every failure screenshot is a logged-in page.
#
# USAGE
#   bash scripts/encrypt-evidence.sh --name <id> --recipients <file> [--match <glob>] -- <dir>...
#       <id> matches ^[a-z0-9][a-z0-9-]*$. Each <dir> is a relative directory; an absent one is
#       skipped. --match keeps only files whose basename matches <glob> (no slash allowed).
#       With no file left to pack it prints "no input — nothing to encrypt", exits 0 and creates
#       nothing. Otherwise it writes enc/<id>/<id>.tar.age and prints the file count, the size and
#       "post-check PASS". It never prints a member name or any file content.
#   bash scripts/encrypt-evidence.sh --check-recipients <file>
#       The file must hold exactly one non-comment, non-blank line, an age1 X25519 recipient.
#       Prints one PROBLEM line per fault (missing-file, no-recipient, malformed-recipient line <n>,
#       extra-line line <n>, private-key line <n>; never the line's content), then "recipients: OK"
#       (exit 0) or "recipients: FAIL" (exit 1).
#   AGE_BIN=... AGE_KEYGEN_BIN=... bash scripts/encrypt-evidence.sh --self-test
#       Eleven cases in a fresh temp dir with a throwaway key pair made and deleted there; nothing is
#       written into the checkout. Last line "self-test: PASS 11 of 11" (exit 0) or
#       "self-test: FAIL <f> of 11" (exit 1).
#
# EXIT CODES: 0 success (or no input); 1 a failed check, tar, age or post-check; 2 a usage error or
# a refused input. On any non-zero exit an EXIT trap removes enc/<id>/, so the upload after the step
# finds nothing. Runs on macOS /bin/bash 3.2 and on GNU bash 5 (no mapfile, no associative arrays,
# empty arrays guarded under set -u).
#
# DECISION Phase 88.6.2-27 (D-16): age with a classic X25519 recipient, chosen OVER gpg (absent on the decrypting Mac, no Intel Monterey bottle) and OVER openssl cms (long flags, certificate expiry, GCM untested on the runner's 3.0.13). Changing this is a decision, not a cleanup.
#
# DECISION Phase 88.6.2-27 (D-17): tar piped straight into age with no plaintext copy, exclusions as find predicates AND tar --exclude, fail closed (any failure leaves nothing to upload), chosen OVER a plaintext fallback, OVER per-step inline copies (two exclusion lists drift) and OVER a passphrase in a GitHub secret (P3). Changing this is a decision, not a cleanup.
#
# The two exclusions are 88.6 CR-01 (no *.zip: a Playwright trace.zip records every action's
# parameters in plain text, the typed E2E password included) and 88.6-61 R2-H5 (no
# error-context.md: its aria snapshot serialises typed input values). They are applied to every
# input, twice over: find's -name is basename matching on BSD and GNU alike, and tar's --exclude is
# the arm D-17 names. The script also refuses an input that is absolute, holds "..", has a .auth
# segment (the appSession storageState, T-82-12) or names playwright-results.json.
# Lockstep-pinned by src/lib/ci-grep-gate.fixture.test.ts ("Phase 88.6.2-27 — failure evidence
# leaves CI only as age ciphertext (R7, T-88.6-G34)").

set -euo pipefail
umask 077

usage() {
  cat >&2 <<'USAGE'
usage: encrypt-evidence.sh --name <id> --recipients <file> [--match <glob>] -- <dir>...
       encrypt-evidence.sh --check-recipients <file>
       encrypt-evidence.sh --self-test
USAGE
}

usage_error() {
  echo "encrypt-evidence: ERROR $1" >&2
  usage
  exit 2
}

# One PROBLEM line per fault, then the verdict. Line content is never printed.
check_recipients() {
  local file="$1" n=0 recipients=0 problems=0 line trimmed
  local recipient_re='^age1[02-9ac-hj-np-z]{58}$'
  if [ ! -f "$file" ]; then
    echo "PROBLEM missing-file"
    echo "recipients: FAIL"
    return 1
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    if printf '%s\n' "$line" | grep -qi 'AGE-SECRET-KEY'; then
      echo "PROBLEM private-key line $n"
      problems=$((problems + 1))
      continue
    fi
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      '' | '#'*) continue ;;
    esac
    recipients=$((recipients + 1))
    if [ "$recipients" -gt 1 ]; then
      echo "PROBLEM extra-line line $n"
      problems=$((problems + 1))
      continue
    fi
    if ! [[ $line =~ $recipient_re ]]; then
      echo "PROBLEM malformed-recipient line $n"
      problems=$((problems + 1))
    fi
  done < "$file"
  if [ "$recipients" -eq 0 ]; then
    echo "PROBLEM no-recipient"
    problems=$((problems + 1))
  fi
  if [ "$problems" -eq 0 ]; then
    echo "recipients: OK"
    return 0
  fi
  echo "recipients: FAIL"
  return 1
}

# The member list, NUL-separated, for the inputs in PRESENT. The only find in the script.
list_members() {
  find "${PRESENT[@]}" -type f ! -name '*.zip' ! -name 'error-context.md' ${MATCH_ARGS[@]+"${MATCH_ARGS[@]}"} -print0
}

ENC_CREATED=0
OUT_CREATED=0
SUCCESS=0
OUT=''

cleanup_encrypt() {
  if [ "$SUCCESS" != 1 ]; then
    if [ "$OUT_CREATED" = 1 ] && [ -n "$OUT" ]; then rm -rf "$OUT"; fi
    if [ "$ENC_CREATED" = 1 ]; then rmdir enc 2>/dev/null || true; fi
  fi
}

encrypt_main() {
  local NAME='' RECIPIENTS='' MATCH='' have_match=0 d n bytes first entries age_path
  local name_re='^[a-z0-9][a-z0-9-]*$'
  while [ $# -gt 0 ]; do
    case "$1" in
      --name)
        [ $# -ge 2 ] || usage_error "--name needs a value"
        NAME="$2"
        shift 2
        ;;
      --recipients)
        [ $# -ge 2 ] || usage_error "--recipients needs a value"
        RECIPIENTS="$2"
        shift 2
        ;;
      --match)
        [ $# -ge 2 ] || usage_error "--match needs a value"
        MATCH="$2"
        have_match=1
        shift 2
        ;;
      --)
        shift
        break
        ;;
      *) usage_error "unknown or misplaced argument" ;;
    esac
  done
  [ -n "$NAME" ] || usage_error "--name is required"
  [[ $NAME =~ $name_re ]] || usage_error "--name must match ^[a-z0-9][a-z0-9-]*\$"
  [ -n "$RECIPIENTS" ] || usage_error "--recipients is required"
  if [ "$have_match" = 1 ]; then
    [ -n "$MATCH" ] || usage_error "--match needs a non-empty glob"
    case "$MATCH" in */*) usage_error "--match takes a basename glob with no slash" ;; esac
  fi
  [ $# -ge 1 ] || usage_error "no input directory after --"

  # 1. Refuse unsafe inputs before anything is read or written; skip absent ones.
  for d in "$@"; do
    case "$d" in
      '' | -*) usage_error "$NAME: refused input: empty or starts with a dash" ;;
      /*) usage_error "$NAME: refused input: absolute path" ;;
      *..*) usage_error "$NAME: refused input: holds .." ;;
    esac
    case "/$d/" in
      */.auth/*) usage_error "$NAME: refused input: a .auth segment (T-82-12)" ;;
      */playwright-results.json/*) usage_error "$NAME: refused input: playwright-results.json" ;;
    esac
  done
  PRESENT=()
  for d in "$@"; do
    while [ "${d%/}" != "$d" ]; do d="${d%/}"; done
    if [ -L "$d" ]; then
      usage_error "$NAME: refused input: a symbolic link"
    elif [ -e "$d" ]; then
      [ -d "$d" ] || usage_error "$NAME: refused input: exists but is not a directory"
      PRESENT+=("$d")
    fi
  done

  # 2. The recipients rule, before any member is listed.
  if ! check_recipients "$RECIPIENTS"; then
    echo "encrypt-evidence: $NAME: ERROR the recipients file failed its check" >&2
    exit 1
  fi

  # 3. The member list (counted only; names are never printed).
  MATCH_ARGS=()
  if [ "$have_match" = 1 ]; then MATCH_ARGS=(-name "$MATCH"); fi
  n=0
  if [ "${#PRESENT[@]}" -gt 0 ]; then
    n=$(list_members | tr -dc '\000' | wc -c | tr -d '[:space:]')
  fi
  if [ "$n" -eq 0 ]; then
    echo "encrypt-evidence: $NAME: no input — nothing to encrypt"
    exit 0
  fi

  # 4. age must resolve.
  if ! age_path=$(command -v "${AGE_BIN:-age}"); then
    echo "encrypt-evidence: $NAME: ERROR age not found (AGE_BIN=${AGE_BIN:-age})" >&2
    exit 1
  fi

  # 5. A fresh output dir, removed by the EXIT trap unless the run succeeds.
  OUT="enc/$NAME"
  if [ -e "$OUT" ] || [ -L "$OUT" ]; then
    echo "encrypt-evidence: $NAME: ERROR $OUT already exists" >&2
    exit 1
  fi
  trap cleanup_encrypt EXIT
  trap 'exit 1' HUP INT TERM
  if [ ! -d enc ]; then
    mkdir enc
    ENC_CREATED=1
  fi
  mkdir "$OUT"
  OUT_CREATED=1

  # 6. ONE pipeline: no plaintext copy is ever written.
  list_members | tar -c -f - --null --exclude='*.zip' --exclude='error-context.md' -T - | "$age_path" -R "$RECIPIENTS" -o "$OUT/$NAME.tar.age"

  # 7. Post-check: exactly one non-empty file whose first line is the age header.
  entries=$(ls -A "$OUT")
  if [ "$entries" != "$NAME.tar.age" ]; then
    echo "encrypt-evidence: $NAME: ERROR post-check: $OUT must hold exactly $NAME.tar.age" >&2
    exit 1
  fi
  if [ ! -s "$OUT/$NAME.tar.age" ]; then
    echo "encrypt-evidence: $NAME: ERROR post-check: $OUT/$NAME.tar.age is empty" >&2
    exit 1
  fi
  first=$(head -n 1 "$OUT/$NAME.tar.age" 2>/dev/null | LC_ALL=C tr -d '\000')
  if [ "$first" != "age-encryption.org/v1" ]; then
    echo "encrypt-evidence: $NAME: ERROR post-check: first line is not the age header" >&2
    exit 1
  fi

  # 8. Counts and size only.
  bytes=$(wc -c < "$OUT/$NAME.tar.age" | tr -d '[:space:]')
  echo "encrypt-evidence: $NAME: $n file(s) -> $OUT/$NAME.tar.age ($bytes bytes)"
  echo "encrypt-evidence: $NAME: post-check PASS"
  SUCCESS=1
}

# ---------------------------------------------------------------------------------------------
# Self-test: eleven cases, each running this script as a subprocess inside a temp dir.

ST_PASS=0
ST_FAIL=0
ST_DIR=''

st_report() {
  if [ "$2" = 1 ]; then
    echo "self-test: case $1: PASS"
    ST_PASS=$((ST_PASS + 1))
  else
    echo "self-test: case $1: FAIL"
    ST_FAIL=$((ST_FAIL + 1))
  fi
}

st_cleanup() {
  cd /
  if [ -n "$ST_DIR" ]; then rm -rf "$ST_DIR"; fi
}

# Run the script under test in the current dir; sets RC and OUTPUT.
st_run() {
  RC=0
  OUTPUT=$("$BASH" "$SELF" "$@" 2>&1) || RC=$?
}

st_count() {
  # st_count <fixed string> <file>: occurrences counted as lines, binary-safe.
  LC_ALL=C grep -a -c -F -- "$1" "$2" || true
}

self_test() {
  local age_bin keygen_bin pub bad last marker ok listing
  if ! age_bin=$(command -v "${AGE_BIN:-age}"); then
    echo "self-test: ERROR age not found (set AGE_BIN)" >&2
    exit 1
  fi
  if ! keygen_bin=$(command -v "${AGE_KEYGEN_BIN:-age-keygen}"); then
    echo "self-test: ERROR age-keygen not found (set AGE_KEYGEN_BIN)" >&2
    exit 1
  fi
  ST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/encrypt-evidence-selftest.XXXXXX")
  trap st_cleanup EXIT
  trap 'exit 1' HUP INT TERM
  cd "$ST_DIR"

  # The throwaway pair: the identity stays in id.txt here and is never printed.
  "$keygen_bin" -o id.txt 2> keygen.err > /dev/null
  pub=$(sed -n 's/^Public key: //p' keygen.err)
  rm -f keygen.err
  last="${pub#"${pub%?}"}"
  if [ "$last" = q ]; then bad="${pub%?}p"; else bad="${pub%?}q"; fi
  printf '# self-test recipient\n%s\n' "$pub" > recipients.txt
  printf '# valid shape, bad checksum\n%s\n' "$bad" > bad-checksum.txt
  printf '# malformed\nage1notarecipient\n' > malformed.txt
  marker='SELFTEST-PLAINTEXT-MARKER-88627'

  # Case 1: a mixed tree.
  mkdir -p c1 && cd c1
  mkdir -p test-results/a playwright-report/data playwright-report/b
  for f in test-results/a/shot-1.png test-results/a/page.html test-results/a/trace.zip \
    test-results/a/error-context.md playwright-report/index.html playwright-report/data/x.zip \
    playwright-report/b/error-context.md; do
    printf '%s %s\n' "$marker" "$f" > "$f"
  done
  st_run --name playwright-report --recipients ../recipients.txt -- playwright-report/ test-results/
  ok=0
  if [ "$RC" = 0 ] && [ "$(ls -A enc/playwright-report)" = "playwright-report.tar.age" ] \
    && [ "$(head -n 1 enc/playwright-report/playwright-report.tar.age | LC_ALL=C tr -d '\000')" = "age-encryption.org/v1" ] \
    && [ "$(st_count "$marker" enc/playwright-report/playwright-report.tar.age)" = 0 ]; then
    if "$age_bin" -d -i ../id.txt -o out.tar enc/playwright-report/playwright-report.tar.age; then
      listing=$(tar -tf out.tar | LC_ALL=C sort | tr '\n' ' ')
      if [ "$listing" = "playwright-report/index.html test-results/a/page.html test-results/a/shot-1.png " ]; then ok=1; fi
    fi
  fi
  st_report "1 mixed tree encrypts to one tar.age with the header, no plaintext marker, no zip or error-context.md" "$ok"
  cd "$ST_DIR"

  # Case 2: --match keeps only the month-tile png.
  mkdir -p c2/test-results/sub && cd c2
  for f in test-results/sub/month-tile-desktop-week.png test-results/sub/other.png \
    test-results/sub/month-tile-desktop-week.html test-results/month-tile-desktop-x.zip; do
    printf '%s %s\n' "$marker" "$f" > "$f"
  done
  st_run --name month-tile-desktop-screenshots --recipients ../recipients.txt --match 'month-tile-desktop-*.png' -- test-results/
  ok=0
  if [ "$RC" = 0 ] && "$age_bin" -d -i ../id.txt -o out.tar enc/month-tile-desktop-screenshots/month-tile-desktop-screenshots.tar.age; then
    listing=$(tar -tf out.tar | LC_ALL=C sort | tr '\n' ' ')
    if [ "$listing" = "test-results/sub/month-tile-desktop-week.png " ]; then ok=1; fi
  fi
  st_report "2 --match gives exactly the one month-tile png" "$ok"
  cd "$ST_DIR"

  # Case 3: absent inputs.
  mkdir -p c3 && cd c3
  st_run --name playwright-report --recipients ../recipients.txt -- playwright-report/ test-results/
  ok=0
  case "$OUTPUT" in *"playwright-report: no input — nothing to encrypt"*) [ "$RC" = 0 ] && [ ! -e enc ] && ok=1 ;; esac
  st_report "3 absent inputs exit 0 with the no-input line and create nothing" "$ok"
  cd "$ST_DIR"

  # Case 4: inputs holding only excluded files.
  mkdir -p c4/test-results/x && cd c4
  printf '%s\n' "$marker" > test-results/x/trace.zip
  printf '%s\n' "$marker" > test-results/x/error-context.md
  st_run --name playwright-report --recipients ../recipients.txt -- test-results/
  ok=0
  case "$OUTPUT" in *"no input — nothing to encrypt"*) [ "$RC" = 0 ] && [ ! -e enc ] && ok=1 ;; esac
  st_report "4 only excluded files behave like no input" "$ok"
  cd "$ST_DIR"

  # Case 5: age missing, input present.
  mkdir -p c5/test-results && cd c5
  printf '%s\n' "$marker" > test-results/a.png
  RC=0
  OUTPUT=$(AGE_BIN="$ST_DIR/no-such-age" "$BASH" "$SELF" --name playwright-report --recipients ../recipients.txt -- test-results/ 2>&1) || RC=$?
  ok=0
  if [ "$RC" != 0 ] && [ ! -e enc/playwright-report ]; then ok=1; fi
  st_report "5 a missing AGE_BIN exits non-zero and leaves no dir" "$ok"
  cd "$ST_DIR"

  # Case 6: a malformed recipient line.
  mkdir -p c6/test-results && cd c6
  printf '%s\n' "$marker" > test-results/a.png
  st_run --check-recipients ../malformed.txt
  ok=0
  case "$OUTPUT" in *"recipients: FAIL"*) [ "$RC" = 1 ] && ok=1 ;; esac
  st_run --name playwright-report --recipients ../malformed.txt -- test-results/
  if [ "$RC" = 0 ] || [ -e enc ]; then ok=0; fi
  st_report "6 a malformed recipient line is refused by the recipients check" "$ok"
  cd "$ST_DIR"

  # Case 7: valid shape, bad checksum: age itself fails.
  mkdir -p c7/test-results && cd c7
  printf '%s\n' "$marker" > test-results/a.png
  ok=0
  st_run --check-recipients ../bad-checksum.txt
  if [ "$RC" = 0 ]; then
    st_run --name playwright-report --recipients ../bad-checksum.txt -- test-results/
    if [ "$RC" != 0 ] && [ ! -e enc/playwright-report ]; then ok=1; fi
  fi
  st_report "7 a bad-checksum recipient makes age fail and the trap removes the dir" "$ok"
  cd "$ST_DIR"

  # Case 8: the identity file passed as recipients.
  mkdir -p c8/test-results && cd c8
  printf '%s\n' "$marker" > test-results/a.png
  st_run --name playwright-report --recipients ../id.txt -- test-results/
  ok=0
  case "$OUTPUT" in
    *"PROBLEM private-key"*)
      if [ "$RC" != 0 ] && [ ! -e enc ] && [ "$(printf '%s\n' "$OUTPUT" | grep -ci 'AGE-SECRET-KEY' || true)" = 0 ]; then ok=1; fi
      ;;
  esac
  st_report "8 an identity as recipients gives PROBLEM private-key, no key echoed, no dir" "$ok"
  cd "$ST_DIR"

  # Stubs for cases 9 and 10: each reads stdin and writes to its -o argument.
  cat > age-partial.sh <<'STUB'
#!/usr/bin/env bash
out=''
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
cat > /dev/null
printf 'age-encryption.org/v1\n-> X25519 ' > "$out"
exit 1
STUB
  cat > age-plaintext.sh <<'STUB'
#!/usr/bin/env bash
out=''
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
cat > "$out"
exit 0
STUB
  chmod 700 age-partial.sh age-plaintext.sh

  # Case 9: age writes a partial header and exits 1.
  mkdir -p c9/test-results && cd c9
  printf '%s\n' "$marker" > test-results/a.png
  RC=0
  OUTPUT=$(AGE_BIN="$ST_DIR/age-partial.sh" "$BASH" "$SELF" --name playwright-report --recipients ../recipients.txt -- test-results/ 2>&1) || RC=$?
  ok=0
  if [ "$RC" != 0 ] && [ ! -e enc/playwright-report ]; then ok=1; fi
  st_report "9 an age that writes a partial header and exits 1 leaves no dir" "$ok"
  cd "$ST_DIR"

  # Case 10: age exits 0 but writes plaintext.
  mkdir -p c10/test-results && cd c10
  printf '%s\n' "$marker" > test-results/a.png
  RC=0
  OUTPUT=$(AGE_BIN="$ST_DIR/age-plaintext.sh" "$BASH" "$SELF" --name playwright-report --recipients ../recipients.txt -- test-results/ 2>&1) || RC=$?
  ok=0
  if [ "$RC" != 0 ] && [ ! -e enc/playwright-report ]; then ok=1; fi
  st_report "10 an age that exits 0 with plaintext fails the post-check and leaves no dir" "$ok"
  cd "$ST_DIR"

  # Case 11: .auth/ and playwright-results.json inputs are refused before anything is written.
  mkdir -p c11/.auth c11/playwright-results.json && cd c11
  printf '%s\n' "$marker" > .auth/user.json
  printf '%s\n' "$marker" > playwright-results.json/x.png
  ok=0
  st_run --name playwright-report --recipients ../recipients.txt -- .auth/
  if [ "$RC" != 0 ] && [ ! -e enc ]; then
    st_run --name playwright-report --recipients ../recipients.txt -- playwright-results.json
    if [ "$RC" != 0 ] && [ ! -e enc ]; then ok=1; fi
  fi
  st_report "11 a .auth/ or playwright-results.json input is refused before anything is written" "$ok"
  cd "$ST_DIR"

  if [ "$ST_FAIL" -eq 0 ] && [ "$ST_PASS" -eq 11 ]; then
    echo "self-test: PASS $ST_PASS of 11"
    exit 0
  fi
  echo "self-test: FAIL $((11 - ST_PASS)) of 11"
  exit 1
}

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
SELF="$SELF_DIR/$(basename "$0")"

if [ $# -eq 0 ]; then usage_error "no arguments"; fi
case "$1" in
  --check-recipients)
    [ $# -eq 2 ] || usage_error "--check-recipients takes exactly one file"
    if check_recipients "$2"; then exit 0; else exit 1; fi
    ;;
  --self-test)
    [ $# -eq 1 ] || usage_error "--self-test takes no argument"
    self_test
    ;;
  *) encrypt_main "$@" ;;
esac
