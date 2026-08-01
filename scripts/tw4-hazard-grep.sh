#!/usr/bin/env bash
#
# scripts/tw4-hazard-grep.sh
#
# Phase 87.7 (R4 / D-10 layer 1) — the reproducible "no stale v3 utility survived the
# codemod" artifact. Greps the FE app source for the Tailwind v3-only utility tokens that
# the v4 upgrade codemod renames or retires, and exits nonzero if any of them is still in
# `src/` after the migration. This is the grep half of D-10's three-layer verification
# (layer 2 is the computed-style spec, layer 3 is the emitted-CSS selector diff).
#
# NOT wired into CI — same disposition as its analog `scripts/identity-census-gate.sh`
# ("NOT wired into CI ... run at VERIFY TIME"). Two reasons:
#   (a) At the moment this script is COMMITTED the tree is still on Tailwind v3, so a
#       CI-wired gate would be RED on its own introducing commit and on every commit until
#       the codemod plan lands. A gate that ships red teaches people to ignore it.
#   (b) It asserts that a ONE-TIME migration converged. Phase 88 rewrites this whole
#       styling layer, so a permanent CI gate here becomes Phase 88's maintenance burden
#       for no residual risk.
# It is run per-wave and at verify time instead, and its output recorded in the phase's
# verification doc. It is safe to re-run any number of times; it writes nothing.
#
# IDIOM (mirrors `identity-census-gate.sh` and the FE ci.yml compare-gate): grep with
# `|| true` — grep exits nonzero on NO MATCH, so an EMPTY result is the PASS case here —
# filter comments, and `exit 1` only when a real HIT survives.
#
# SCOPE — ALL of `src/`, no file-name exclusions at all (contrast the census gate, which
# needs two). Nothing under `src/` is allowed to contain a forbidden literal, because the
# negative control lives INSIDE this script (`--self-test`) rather than in a fixture file.
#
# CLAIM SCOPE — read this before quoting a PASS anywhere. This gate proves the ABSENCE of
# v3-only tokens that v4 RENAMED or REMOVED (`rounded` bare, `flex-shrink-0`,
# `outline-none`, `bg-opacity-50`, …). It CANNOT prove the other direction: that a class
# name v4 REUSED is not silently carrying its OLD v3 meaning forward. `rounded-sm`,
# `shadow-sm` and `backdrop-blur-sm` all exist in BOTH versions with DIFFERENT values, so
# a surviving-v3-semantics instance of one of them is textually indistinguishable from a
# legitimate new v4 usage. That class of regression is a visual/manual-review concern
# (D-10 layers 2 and 3, plus the owner walkthrough) and is explicitly NOT covered by this
# gate's exit code.
#
# PATTERN — why the regexes are shaped the way they are (traps measured in RESEARCH
# § "Codemod Rename Inventory"):
#   • `rounded` is on BOTH SIDES of the rename: v3 `rounded` -> v4 `rounded-sm` (102 sites)
#     AND v3 `rounded-sm` -> v4 `rounded-xs` (34 sites). So after the migration the tree
#     legitimately contains ~68 `rounded-sm` tokens, and a naive `grep rounded-sm` finds
#     every one of them. The only sound assertion is "no BARE `rounded`" (plus
#     "no `flex-shrink-*`"), NEVER "no `rounded-sm`". Same for bare `shadow` and bare
#     `ring`.
#   • `backdrop-blur-sm` has the same two-sided problem with NO unambiguous form: v4
#     shifted the blur scale (old `-sm` -> `-xs`, old default -> `-sm`), so the identical
#     token means different blur amounts before and after. It therefore gets its own
#     REVIEW-ONLY check: counted and printed, never an auto-fail, because a hit is not
#     proof of a hazard (see CLAIM SCOPE).
#   • Token boundaries are spelled out as explicit character classes rather than `\b`.
#     `\b` treats `-` as a word separator, which is wrong for hyphenated Tailwind tokens
#     (it would let `wrap-break-word`-shaped compounds satisfy a `break-words` boundary),
#     and `\b` is a GNU/PCRE extension that BSD grep does not guarantee. The classes below
#     are hyphen-aware and portable.
#
# DECISION Phase 87.7 (R4): this gate lives at flat `scripts/tw4-hazard-grep.sh`, chosen
# OVER `scripts/ci/tw4-hazard-grep.sh`. `scripts/ci/` is the BACKEND's convention
# (`periodictabletopbackend_v2/Sonnet/scripts/ci/`); the FE `scripts/` directory is flat
# (`generate-ai-map.mjs`, `identity-census-gate.sh`), so flat matches FE precedent and
# introduces zero new structure. Moving it is a decision, not a cleanup.
#
# DECISION Phase 87.7 (R4): the negative control is the built-in `--self-test` mode below,
# chosen OVER a `src/lib/tw4-hazard-gate.fixture.test.ts` (the shape used for the 87.3
# compare-gate). Reason: THIS gate scans ALL of `src/`, so a fixture file under `src/lib/`
# holding the forbidden literals (`rounded`, `flex-shrink-0`, `bg-opacity-50`) would be
# INSIDE the gate's own scope and would self-red it — a problem the 87.3 gate never had
# because it scans `src/app` only. Fixing that with a file-name exclusion list adds a list
# that can rot. Keeping the fixtures as in-script string literals means no file under
# `src/` ever contains a forbidden literal and the control is runnable on demand. Adding
# the fixture test back is a decision, not a cleanup.
#
# Run from the FE repo root (it cd's to the repo root itself, so cwd does not matter):
#   bash scripts/tw4-hazard-grep.sh
#   bash scripts/tw4-hazard-grep.sh --self-test
#   bash scripts/tw4-hazard-grep.sh --except <label>[,<label>...]
#
# Machine-readable output: the LAST line is always
#   RESULT bare-rounded=<n> bare-shadow=<n> bare-ring=<n> backdrop-blur-sm=<n> \
#          renamed-utilities=<n> opacity-utilities=<n> tailwind-directives=<n> \
#          config-reference=<n>
# in that fixed order, one count per check, printed in every mode. Downstream verify steps
# should parse THAT line by structure — never scrape the free-text messages, whose wording
# is not a contract.
#
# Exit codes: 0 = pass, 1 = a non-excluded auto-fail check matched, 2 = usage/setup error.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
SRC_DIR="src"

# ─────────────────────────────────────────────────────────────────────────────
# Patterns
# ─────────────────────────────────────────────────────────────────────────────
# Built from pieces so the delimiter spec is stated once and cannot drift between checks.
BT='`'
SQ="'"

# A bare utility token must be delimited on BOTH sides. Opening side: start of line, a
# quote/backtick/semicolon/space, OR a colon — the colon matters twice over, because grep's
# own `path:line:` output prefix ends in one AND because Tailwind variants end in one.
# Closing side: quote/backtick/semicolon/space OR end of line — a bare token at the end of a
# template-literal line has no trailing space, and a `;` terminator is common in the
# `class="…";` and `clsx(…);` shapes, so neither may be omitted.
DELIM_OPEN="(^|[:\"${SQ}${BT}; ])"
DELIM_CLOSE="[\"${SQ}${BT}; ]"
# An arbitrary Tailwind VARIANT PREFIX CHAIN: `hover:`, `md:`, `dark:`, `focus-visible:`,
# `group-hover:`, `peer-checked:`, or several stacked. NOT limited to focus/focus-visible —
# `md:flex-shrink-0` is a measured site in the rename inventory.
VARIANT="([a-z0-9]+(-[a-z0-9]+)*:)*"

# Hyphen-aware token boundaries (see PATTERN note above — deliberately not `\b`).
TOK_OPEN="(^|[^a-zA-Z0-9_-])"
TOK_CLOSE="($|[^a-zA-Z0-9_-])"

P_BARE_ROUNDED="${DELIM_OPEN}${VARIANT}rounded(${DELIM_CLOSE}|\$)"
P_BARE_SHADOW="${DELIM_OPEN}${VARIANT}shadow(${DELIM_CLOSE}|\$)"
P_BARE_RING="${DELIM_OPEN}${VARIANT}ring(${DELIM_CLOSE}|\$)"
P_BACKDROP_BLUR="${DELIM_OPEN}${VARIANT}backdrop-blur-sm(${DELIM_CLOSE}|\$)"
P_RENAMED="${TOK_OPEN}(flex-shrink-[0-9]|flex-grow-[0-9]|outline-none|break-words|overflow-ellipsis|decoration-(slice|clone))${TOK_CLOSE}"
P_OPACITY="${TOK_OPEN}(bg|text|border|ring|divide|placeholder)-opacity-[0-9]+${TOK_CLOSE}"
P_DIRECTIVES="@tailwind "
P_CONFIG="@config|tailwind\.config"

# Fixed RESULT-line order. Also the order checks are run in.
CHECK_ORDER="bare-rounded bare-shadow bare-ring backdrop-blur-sm renamed-utilities opacity-utilities tailwind-directives config-reference"

pattern_for() {
  case "$1" in
    bare-rounded)        printf '%s' "$P_BARE_ROUNDED" ;;
    bare-shadow)         printf '%s' "$P_BARE_SHADOW" ;;
    bare-ring)           printf '%s' "$P_BARE_RING" ;;
    backdrop-blur-sm)    printf '%s' "$P_BACKDROP_BLUR" ;;
    renamed-utilities)   printf '%s' "$P_RENAMED" ;;
    opacity-utilities)   printf '%s' "$P_OPACITY" ;;
    tailwind-directives) printf '%s' "$P_DIRECTIVES" ;;
    config-reference)    printf '%s' "$P_CONFIG" ;;
    *) return 1 ;;
  esac
}

fix_for() {
  case "$1" in
    bare-rounded)        printf '%s' "bare \`rounded\` is v3 — the v4 equivalent is \`rounded-sm\` (and v3's \`rounded-sm\` is v4's \`rounded-xs\`)" ;;
    bare-shadow)         printf '%s' "bare \`shadow\` is v3 — the v4 equivalent is \`shadow-sm\` (and v3's \`shadow-sm\` is v4's \`shadow-xs\`)" ;;
    bare-ring)           printf '%s' "bare \`ring\` is v3's 3px ring — the v4 equivalent is \`ring-3\` (v4's bare \`ring\` is 1px)" ;;
    backdrop-blur-sm)    printf '%s' "REVIEW ONLY: v3 \`backdrop-blur-sm\` became v4 \`backdrop-blur-xs\`, and v4 reused the \`-sm\` name for a bigger blur — confirm visually which one each site means" ;;
    renamed-utilities)   printf '%s' "renamed/removed in v4 — \`flex-shrink-N\`->\`shrink-N\`, \`flex-grow-N\`->\`grow-N\`, \`outline-none\`->\`outline-hidden\`, \`break-words\`->\`wrap-break-word\`, \`overflow-ellipsis\`->\`text-ellipsis\`, \`decoration-slice/clone\`->\`box-decoration-slice/clone\`" ;;
    opacity-utilities)   printf '%s' "\`*-opacity-N\` was removed in v4 and emits NO CSS (silent failure) — use the slash modifier, e.g. \`bg-black/50\`" ;;
    tailwind-directives) printf '%s' "\`@tailwind\` directives are v3 — v4 uses a single \`@import \"tailwindcss\";\`" ;;
    config-reference)    printf '%s' "\`tailwind.config.js\` is deleted this phase (D-01) and there is no \`@config\` rump — move the value into \`@theme\`/\`@theme inline\` in globals.css" ;;
    *) printf '%s' "unknown check" ;;
  esac
}

# Checks whose hits are REVIEW FLAGS, never auto-failures (see CLAIM SCOPE / PATTERN).
is_review_only() { [ "$1" = "backdrop-blur-sm" ]; }

# ─────────────────────────────────────────────────────────────────────────────
# strip_comments — drop comment text from grep output, anchored AFTER the `path:line:`
# prefix that `grep -rEn` emits.
#
# The census gate's one-liner (`grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)'`) only sees
# lines that THEMSELVES start with a comment marker. That is not enough here:
# `src/app/globals.css`'s house style writes block-comment CONTINUATION lines with NO
# leading `*`, and this phase's own decision comments in that file necessarily NAME retired
# utilities. A marker-only filter would read those continuation lines as live code and
# report prose as a hazard.
#
# So this filter tracks `/* … */` comment SPANS across MULTIPLE lines:
#   • For a READABLE path, it reads the file once and computes the true block-comment state
#     at the start of every line — which is the only way to be right when the line that
#     OPENED the comment did not itself match the grep pattern and so never appears in the
#     stream.
#   • For an UNREADABLE path (the `--self-test` fixtures, which use a synthetic
#     `path:line:` prefix and no file on disk), it falls back to state carried forward from
#     the previous line of that same path in the stream.
# It then blanks the comment text within the line and drops the line if nothing but comment
# remains. The caller re-applies its pattern to the surviving text, so a hazard that sat
# only inside a comment disappears while one that sat in real code on the same line does
# not.
#
# Deliberate conservatism: `//` is treated as a comment ONLY when the line's live text
# before it is blank. A mid-line `//` is far more often a URL (`https://…`) than a comment,
# and wrongly blanking the rest of such a line would HIDE a hazard. Erring toward "this is
# code" is the safe direction for a gate.
# ─────────────────────────────────────────────────────────────────────────────
strip_comments() {
  awk '
    # state at end of the line, given the state at its start
    function end_state(s, inc,   i, n, c2) {
      i = 1; n = length(s)
      while (i <= n) {
        c2 = substr(s, i, 2)
        if (inc) {
          if (c2 == "*/") { inc = 0; i += 2 } else { i++ }
        } else {
          if (c2 == "/*") { inc = 1; i += 2 }
          else if (c2 == "//") { return 0 }     # rest of line is comment or a URL; neither opens a block
          else { i++ }
        }
      }
      return inc
    }
    # the line with all comment text removed
    function strip_line(s, inc,   out, i, n, c2) {
      out = ""; i = 1; n = length(s)
      while (i <= n) {
        c2 = substr(s, i, 2)
        if (inc) {
          if (c2 == "*/") { inc = 0; i += 2 } else { i++ }
        } else {
          if (c2 == "/*") { inc = 1; i += 2 }
          else if (c2 == "//" && out ~ /^[ \t]*$/) { break }
          else { out = out substr(s, i, 1); i++ }
        }
      }
      return out
    }
    function scan(f,   ln, s, inc) {
      scanned[f] = 1; readable[f] = 0; inc = 0; ln = 0
      while ((getline s < f) > 0) {
        ln++; readable[f] = 1
        st[f SUBSEP ln] = inc
        inc = end_state(s, inc)
      }
      close(f)
    }
    {
      line = $0
      if (!match(line, /^[^:]+:[0-9]+:/)) { print; next }   # not grep -n output; pass through untouched
      pre  = substr(line, 1, RLENGTH)
      body = substr(line, RLENGTH + 1)
      cut  = index(pre, ":")
      path = substr(pre, 1, cut - 1)
      rest = substr(pre, cut + 1)
      lineno = substr(rest, 1, length(rest) - 1) + 0

      if (!(path in scanned)) scan(path)
      if (readable[path] && ((path SUBSEP lineno) in st)) inc = st[path SUBSEP lineno]
      else if (path in carry) inc = carry[path]
      else inc = 0

      out = strip_line(body, inc)
      carry[path] = end_state(body, inc)

      if (out ~ /^[ \t]*$/) next
      # Fallback for unreadable paths only: a JSDoc/CSS continuation line starting with `*`
      # whose opener never entered the stream. Real code does not start a line with `*`.
      if (!readable[path] && out ~ /^[ \t]*\*/) next
      print pre out
    }
  '
}

# The post-grep filter stage, isolated so `--self-test` can drive the EXACT same code path
# with fixture strings instead of a real tree.
filter_hits() { # $1 = ERE ; stdin = `path:line:content` lines
  strip_comments | grep -E "$1" || true
}

count_lines() {
  if [ -z "$1" ]; then printf '0'; else printf '%s' "$1" | grep -c '' | tr -d ' '; fi
}

var_of() { printf 'COUNT_%s' "$(printf '%s' "$1" | tr '-' '_')"; }

# ─────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────────────────────────────────
MODE="scan"
EXCEPT=""

usage() {
  echo "usage: bash scripts/tw4-hazard-grep.sh [--self-test] [--except <label>[,<label>...]]"
  echo "  labels: ${CHECK_ORDER}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --self-test) MODE="self-test"; shift ;;
    --except)    shift; [ "$#" -gt 0 ] || { echo "::error:: --except needs a value"; usage; exit 2; }; EXCEPT="$1"; shift ;;
    --except=*)  EXCEPT="${1#--except=}"; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "::error:: unknown argument: $1"; usage; exit 2 ;;
  esac
done

# Validate --except labels up front: a typo'd label would otherwise silently exclude
# nothing and the gate would look stricter than it is.
if [ -n "$EXCEPT" ]; then
  for lbl in $(printf '%s' "$EXCEPT" | tr ',' ' '); do
    if ! pattern_for "$lbl" >/dev/null 2>&1; then
      echo "::error:: --except: unknown check label '${lbl}'"
      usage
      exit 2
    fi
  done
fi

is_excluded() { # $1 = label
  case ",${EXCEPT}," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# The scan
# ─────────────────────────────────────────────────────────────────────────────
FAIL=0

run_check() { # $1 = label ; $2 = quiet(1) to suppress the hit listing
  local label="$1" quiet="${2:-0}" pattern hits count
  pattern="$(pattern_for "$label")"
  # -I skips binary files; `|| true` because grep exits 1 on the (desirable) no-match case.
  hits=$(grep -rEnI "$pattern" "$SRC_DIR" 2>/dev/null | filter_hits "$pattern" || true)
  count=$(count_lines "$hits")
  eval "$(var_of "$label")=$count"
  [ "$count" -eq 0 ] && return 0
  [ "$quiet" -eq 1 ] && return 0
  if is_review_only "$label"; then
    echo "::notice::[${label}] ${count} site(s) need a human look — $(fix_for "$label")"
    echo "$hits"
  elif is_excluded "$label"; then
    echo "::notice::[${label}] ${count} hit(s), EXCLUDED from the pass/fail decision via --except — $(fix_for "$label")"
    echo "$hits"
  else
    echo "::error::[${label}] ${count} stale v3 utility site(s) survived — $(fix_for "$label")"
    echo "$hits"
    FAIL=1
  fi
  return 0
}

run_all_checks() { # $1 = quiet
  local lbl
  # Every check runs before any exit — an early exit would hide the second hazard class
  # behind the first, and the RESULT line must be complete in every mode.
  for lbl in $CHECK_ORDER; do
    run_check "$lbl" "${1:-0}"
  done
}

print_result_line() {
  local lbl out=""
  for lbl in $CHECK_ORDER; do
    eval "out=\"\${out} ${lbl}=\${$(var_of "$lbl")}\""
  done
  echo "RESULT${out}"
}

# ─────────────────────────────────────────────────────────────────────────────
# --self-test: the negative control
#
# Every fixture is a string literal in THIS file — never a file under `src/`, which is why
# the gate needs no exclusion list (see the second DECISION marker above). Each fixture
# line is given a synthetic `path:line:`-shaped prefix before entering the pipeline,
# because `strip_comments` anchors its logic AFTER that prefix: a bare fixture string with
# no prefix would bypass the anchor entirely and could "pass" a filter that is broken on
# real grep output.
# ─────────────────────────────────────────────────────────────────────────────
SELFTEST_FAIL=0
CHECK_FAIL=0
FIXTURE_PATH="tw4-selftest-fixture.tsx"

fixture_case() { # $1 = expectation HIT|CLEAN ; $2 = pattern ; $3 = fixture text ; $4 = description
  local expect="$1" pattern="$2" text="$3" desc="$4" prefixed out
  prefixed=$(printf '%s\n' "$text" | awk -v f="$FIXTURE_PATH" '{ printf "%s:%d:%s\n", f, NR, $0 }')
  out=$(printf '%s\n' "$prefixed" | filter_hits "$pattern")
  if [ "$expect" = "HIT" ] && [ -z "$out" ]; then
    echo "  ::error:: expected a HIT and got none: ${desc}"
    CHECK_FAIL=1; SELFTEST_FAIL=1
  elif [ "$expect" = "CLEAN" ] && [ -n "$out" ]; then
    echo "  ::error:: expected NO hit and got one: ${desc}"
    echo "$out" | sed 's/^/      /'
    CHECK_FAIL=1; SELFTEST_FAIL=1
  fi
}

end_case() { # $1 = label ; $2 = what was proven (optional)
  local what="${2:-bad fixtures matched, good fixtures ignored}"
  if [ "$CHECK_FAIL" -eq 0 ]; then
    echo "self-test PASS  ${1} — ${what}"
  else
    echo "self-test FAIL  ${1}"
  fi
  CHECK_FAIL=0
}

run_self_test() {
  echo "tw4-hazard-grep --self-test (fixtures are in-script literals; nothing under src/ is touched)"
  echo ""

  # --- bare-rounded -------------------------------------------------------
  fixture_case HIT   "$P_BARE_ROUNDED" '<div className="p-2 rounded bg-surface-page">' 'bare rounded between spaces'
  fixture_case HIT   "$P_BARE_ROUNDED" '<div className="rounded">'                     'bare rounded against quotes'
  fixture_case HIT   "$P_BARE_ROUNDED" 'const c = `border rounded`;'                   'bare rounded before a backtick'
  fixture_case HIT   "$P_BARE_ROUNDED" 'const c = "p-2 rounded";'                      'bare rounded before a semicolon terminator'
  fixture_case HIT   "$P_BARE_ROUNDED" '  p-2 rounded'                                 'bare rounded at end of line (no trailing delimiter)'
  fixture_case HIT   "$P_BARE_ROUNDED" '<div className="hover:rounded">'               'variant-prefixed bare rounded (hover:)'
  fixture_case HIT   "$P_BARE_ROUNDED" '<div className="md:group-hover:rounded">'      'stacked variant chain bare rounded'
  fixture_case CLEAN "$P_BARE_ROUNDED" '<div className="rounded-xs">'                  'rounded-xs is the v4 token'
  fixture_case CLEAN "$P_BARE_ROUNDED" '<div className="rounded-lg p-2">'              'rounded-lg is unchanged in v4'
  fixture_case CLEAN "$P_BARE_ROUNDED" '<div className="rounded-sm">'                  'rounded-sm is legitimate v4 output'
  fixture_case CLEAN "$P_BARE_ROUNDED" '// legacy: this used to say rounded here'      'full-line // comment naming the token'
  fixture_case CLEAN "$P_BARE_ROUNDED" '/* Phase 87.7 note: the codemod turned bare
   rounded into rounded-sm; this continuation line has no leading asterisk
   and must still read as comment. */'                                                 'multi-line block comment, continuation line with no leading asterisk'
  end_case bare-rounded

  # --- bare-shadow --------------------------------------------------------
  fixture_case HIT   "$P_BARE_SHADOW" '<div className="p-2 shadow rounded-sm">'        'bare shadow between spaces'
  fixture_case HIT   "$P_BARE_SHADOW" '<div className="md:shadow">'                    'variant-prefixed bare shadow (md:)'
  fixture_case CLEAN "$P_BARE_SHADOW" '<div className="shadow-xs">'                    'shadow-xs is the v4 token'
  fixture_case CLEAN "$P_BARE_SHADOW" '<div className="shadow-theme-md p-2">'          'shadow-theme-md is a project token'
  fixture_case CLEAN "$P_BARE_SHADOW" '<div className="shadow-sm">'                    'shadow-sm is legitimate v4 output'
  end_case bare-shadow

  # --- bare-ring ----------------------------------------------------------
  fixture_case HIT   "$P_BARE_RING" '<input className="focus:ring focus:ring-blue-500" />' 'variant-prefixed bare ring (focus:)'
  fixture_case HIT   "$P_BARE_RING" '<input className="ring" />'                        'bare ring against quotes'
  fixture_case CLEAN "$P_BARE_RING" '<input className="ring-2 ring-focus-ring" />'      'ring-2 / ring-focus-ring are sized tokens'
  fixture_case CLEAN "$P_BARE_RING" 'const s = "a string mentioning ring-offset-2";'    'ring-offset-2 is not bare'
  end_case bare-ring

  # --- backdrop-blur-sm (review-only) -------------------------------------
  fixture_case HIT   "$P_BACKDROP_BLUR" '<div className="fixed inset-0 backdrop-blur-sm">' 'backdrop-blur-sm site to flag for review'
  fixture_case CLEAN "$P_BACKDROP_BLUR" '<div className="backdrop-blur-xs">'            'backdrop-blur-xs is the v4 rename target'
  fixture_case CLEAN "$P_BACKDROP_BLUR" '<div className="backdrop-blur-smx">'           'not a token boundary'
  end_case backdrop-blur-sm

  # --- renamed-utilities --------------------------------------------------
  fixture_case HIT   "$P_RENAMED" '<div className="flex-shrink-0 p-2">'                'flex-shrink-0'
  fixture_case HIT   "$P_RENAMED" '<div className="md:flex-shrink-0">'                 'variant-prefixed flex-shrink-0'
  fixture_case HIT   "$P_RENAMED" '<button className="focus:outline-none">'            'focus:outline-none'
  fixture_case HIT   "$P_RENAMED" '<p className="break-words">'                        'break-words'
  fixture_case HIT   "$P_RENAMED" '<p className="overflow-ellipsis">'                  'overflow-ellipsis'
  fixture_case HIT   "$P_RENAMED" '<p className="decoration-clone">'                   'decoration-clone'
  fixture_case CLEAN "$P_RENAMED" '<div className="shrink-0 p-2">'                     'shrink-0 is the v4 token'
  fixture_case CLEAN "$P_RENAMED" '<button className="focus:outline-hidden">'          'outline-hidden is the v4 token'
  fixture_case CLEAN "$P_RENAMED" '<p className="wrap-break-word">'                    'wrap-break-word is the v4 token'
  fixture_case CLEAN "$P_RENAMED" '// the codemod rewrote outline-none on this line'    'full-line // comment naming outline-none'
  fixture_case CLEAN "$P_RENAMED" '/* the old value was
   outline-none and flex-shrink-0, both retired in v4.
   No leading asterisk on these lines. */'                                             'multi-line block comment naming retired tokens'
  end_case renamed-utilities

  # --- opacity-utilities --------------------------------------------------
  fixture_case HIT   "$P_OPACITY" '<div className="bg-black bg-opacity-50">'           'bg-opacity-50 (emits no CSS in v4)'
  fixture_case HIT   "$P_OPACITY" '<div className="text-opacity-75">'                  'text-opacity-75'
  fixture_case CLEAN "$P_OPACITY" '<div className="bg-black/50">'                      'slash modifier is the v4 form'
  fixture_case CLEAN "$P_OPACITY" '<div className="opacity-50">'                       'plain opacity-50 is unaffected'
  end_case opacity-utilities

  # --- tailwind-directives ------------------------------------------------
  fixture_case HIT   "$P_DIRECTIVES" '@tailwind base;'                                 'v3 @tailwind directive'
  fixture_case CLEAN "$P_DIRECTIVES" '@import "tailwindcss";'                          'the v4 single-import form'
  end_case tailwind-directives

  # --- config-reference ---------------------------------------------------
  fixture_case HIT   "$P_CONFIG" '@config "../../tailwind.config.js";'                 '@config rump'
  fixture_case HIT   "$P_CONFIG" 'import cfg from "../../tailwind.config.js";'         'a tailwind.config import'
  fixture_case CLEAN "$P_CONFIG" '@theme inline { --color-brand: var(--brand); }'      '@theme inline is the v4 home'
  end_case config-reference

  # --- strip_comments over a REAL file ------------------------------------
  # The fixture cases above drive `strip_comments` with a synthetic prefix and an
  # unreadable path, which exercises its stream-carried fallback. This case exercises the
  # other half: a real file on disk whose comment-OPENING line does not match the pattern
  # and therefore never reaches the filter — the case that a stream-only filter cannot get
  # right. Written to a temp dir, never to `src/`.
  local tmpd out
  tmpd=$(mktemp -d 2>/dev/null) || tmpd=""
  if [ -n "$tmpd" ]; then
    {
      echo '/* Phase 87.7 self-test: the opener line below mentions nothing the gate greps for,'
      echo '   so it never reaches the filter on its own. The bare rounded token on this'
      echo '   line is pure comment prose and must not be reported. */'
      echo 'export const ok = "rounded-xs shadow-xs shrink-0";'
    } > "${tmpd}/selftest-block.tsx"
    out=$(grep -rEnI "$P_BARE_ROUNDED" "$tmpd" 2>/dev/null | filter_hits "$P_BARE_ROUNDED" || true)
    rm -rf "$tmpd"
    if [ -n "$out" ]; then
      echo "  ::error:: real-file multi-line block comment was not stripped"
      echo "$out" | sed 's/^/      /'
      CHECK_FAIL=1; SELFTEST_FAIL=1
    fi
  else
    echo "  ::error:: mktemp -d failed; could not run the real-file comment-state case"
    CHECK_FAIL=1; SELFTEST_FAIL=1
  fi
  end_case "strip_comments/real-file-block-state" "a multi-line block comment in a real file was stripped even though its opening line never matched the pattern"

  # --- --except plumbing --------------------------------------------------
  # Asserts the flag's decision function directly, so the exclusion path is covered even
  # though the live tree cannot produce a config-reference-only failure on demand.
  local saved="$EXCEPT"
  EXCEPT="config-reference"
  is_excluded config-reference || { echo "  ::error:: --except config-reference did not exclude it"; CHECK_FAIL=1; SELFTEST_FAIL=1; }
  if is_excluded bare-rounded; then echo "  ::error:: --except config-reference wrongly excluded bare-rounded"; CHECK_FAIL=1; SELFTEST_FAIL=1; fi
  EXCEPT="config-reference,tailwind-directives"
  is_excluded tailwind-directives || { echo "  ::error:: --except did not handle a comma list"; CHECK_FAIL=1; SELFTEST_FAIL=1; }
  EXCEPT=""
  if is_excluded config-reference; then echo "  ::error:: empty --except excluded something"; CHECK_FAIL=1; SELFTEST_FAIL=1; fi
  EXCEPT="$saved"
  end_case "--except" "a named label (and a comma list) is excluded from the pass/fail decision, and nothing else is"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -d "$SRC_DIR" ]; then
  echo "::error:: ${SRC_DIR}/ not found — run this from the FE repo (periodictabletop/)."
  exit 2
fi

if [ "$MODE" = "self-test" ]; then
  run_self_test
  echo ""
  # The RESULT line is part of every mode's contract. In --self-test the counts are still
  # the REAL counts from the live tree (the fixtures are not counted) — only the EXIT CODE
  # reflects the fixture assertions. Hit listings are suppressed here to keep the control's
  # output readable.
  run_all_checks 1
  print_result_line
  if [ "$SELFTEST_FAIL" -ne 0 ]; then
    echo "tw4-hazard-grep --self-test: FAIL — the gate does not behave as documented; fix it before trusting any PASS."
    exit 1
  fi
  echo "tw4-hazard-grep --self-test: PASS — every check matches its known-bad fixtures and ignores its known-good ones, comments (single- and multi-line, with and without a readable file) are stripped, and --except excludes only what it names."
  exit 0
fi

run_all_checks 0
echo ""
print_result_line

if [ "$FAIL" -ne 0 ]; then
  echo "tw4-hazard-grep: FAIL — stale Tailwind v3 utilities survive in ${SRC_DIR}/ (see the ::error:: lines above)."
  echo "  Reminder (CLAIM SCOPE): a PASS here proves only that RENAMED/REMOVED v3 tokens are gone."
  echo "  It never proves that a v4-reused name (rounded-sm, shadow-sm, backdrop-blur-sm) is not still carrying v3 semantics."
  exit 1
fi

echo "tw4-hazard-grep: PASS — zero bare \`rounded\`/\`shadow\`/\`ring\`, zero renamed-away v3 utilities, zero \`*-opacity-N\` utilities, zero \`@tailwind\` directives and zero \`tailwind.config\`/\`@config\` references remain in ${SRC_DIR}/."
echo "  CLAIM SCOPE: this is an absence proof for RENAMED/REMOVED tokens only. A v4-reused name still carrying v3 semantics is invisible here — that is the walkthrough's and the CSS diff's job."
exit 0
