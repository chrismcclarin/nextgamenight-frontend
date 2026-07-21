#!/usr/bin/env bash
#
# scripts/identity-census-gate.sh
#
# Phase 87.5 (BINT-02, Req 12 / D-07) — the reproducible FE "closure proven by grep, not
# asserted" artifact. Greps the FE app source for the Auth0-`sub` wire-crossing SENDER class
# the identity migration converged away, and exits nonzero on any hit OUTSIDE the census §3
# sanctioned allowlist (`.planning/research/IDENTITY-CENSUS.md`).
#
# NOT wired into CI (D-08): the permanent regression net is the existing FE ci.yml compare-gate
# (with its lockstep src/lib/ci-grep-gate.fixture.test.ts) + the BE wire-sweep. This script is
# run at VERIFY TIME and its output recorded in VERIFICATION.md. It is safe to re-run any number
# of times.
#
# IDIOM (mirrors periodictabletop/.github/workflows/ci.yml compare-gate ~L70-103): grep with
# `|| true` (grep exits nonzero on NO MATCH — an EMPTY result is the PASS case here), filter
# full-line comments, and `exit 1` only when a non-allowlisted HIT survives.
#
# SCOPE — src/app only. This deliberately excludes the two sanctioned/permanent files that live
# OUTSIDE src/app, so they need no per-line allowlist entry:
#   • src/lib/hooks/useSelfIdentity.ts — the ONE sanctioned sub->UUID resolver (census §3). Its
#     `getUser(user?.sub)` lookup PARAM + `queryKey`/`enabled` sub reads are the by-design
#     allowlisted sub-as-param site; the resolver is the single place the sub is legitimately read.
#   • src/lib/ci-grep-gate.fixture.test.ts — the permanent-net compare-gate self-test (D-08), which
#     quotes `user.sub` compare EXAMPLES as string literals; it is not app code and not a sender.
#
# PATTERN — PREFIX-TOLERANT, not a literal `user\?\.sub`. At least 3 of the 28 census-inventoried
# sender sites used a DIFFERENT identity variable name — `authUser?.sub` (ScheduleForm.js:291,
# createEvent.js:656/869). A literal, case-sensitive `user\?\.sub` grep silently MISSES
# `authUser?.sub` (the substring `User?.sub` inside it has a capital `U`). So the target matches
# any identifier ending in `[uU]ser` before an optional `?` and `.sub` — `[A-Za-z_]*[uU]ser\??\.sub`
# — catching `user.sub`, `user?.sub`, `authUser?.sub`, and any other `*User?.sub`-shaped variable.
# The narrowing lives in the allowlist (by surrounding context), NOT in an under-matching target.
#
# Run from the FE repo root:  bash scripts/identity-census-gate.sh
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
SRC_DIR="src/app"

# The prefix-tolerant sender-candidate target (see PATTERN note above).
SUB='[A-Za-z_]*[uU]ser\??\.sub'

# strip grep's `path:line:` prefix and drop full-line comments (`//`, `*`, `/*`).
strip_comments() { grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)' || true; }

FAIL=0

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1 (positive) — a body/object `user_id:` write whose VALUE is sub-shaped. This is the
# FeedbackForm.js:86 class (`user_id: user?.sub || null`), now flipped to send `self.id` (and
# to OMIT the key when unresolved). No allowlist — every product `user_id` wire value must be a
# resolved Users.id UUID, never the sub.
# ─────────────────────────────────────────────────────────────────────────────
C1=$(grep -rnE "user_id:[[:space:]]*${SUB}" "$SRC_DIR" 2>/dev/null | strip_comments || true)
if [ -n "$C1" ]; then
  echo "::FE-CENSUS-GATE FAIL:: a \`user_id:\` body value is sub-shaped (send the resolved self UUID instead):"
  echo "$C1"
  FAIL=1
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 (positive) — a JSX identity prop passing the sub down a prop chain. This is the
# searchAll prop chain (`userId={authUser?.sub}` in ScheduleForm.js/createEvent.js →
# GameComboInput → gamesAPI.searchAll), now flipped to `userId={selfUuid}`. Matches any
# `...Id={ ... *User?.sub ... }` JSX expression. No allowlist.
# ─────────────────────────────────────────────────────────────────────────────
C2=$(grep -rnE "[A-Za-z]*[Ii]d=\{[^}]*${SUB}" "$SRC_DIR" 2>/dev/null | strip_comments || true)
if [ -n "$C2" ]; then
  echo "::FE-CENSUS-GATE FAIL:: a JSX identity prop passes the sub down a prop chain (pass the resolved self UUID instead):"
  echo "$C2"
  FAIL=1
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3 (broad residual) — ALL `*User?.sub` occurrences in src/app, minus the census §3
# sanctioned allowlist SHAPES. Anything that survives is an unclassified sub reference — most
# likely a re-introduced API-arg sender like `getUserGroups(user?.sub)` (which is neither an
# `if (...)` guard nor a `[...]` dep-array, so it survives here and FAILS) — and must be flipped
# to the resolved self UUID or added to the allowlist with a reason.
#
# ALLOWLIST (census §3 — the ~60 harmless truthiness uses that are NOT senders):
#   (a) presence/truthiness GUARDS — the sub read inside an `if (...)` condition
#       (`if (!user?.sub) return;`, `if (user?.sub && groupId) {`, …). Enabling-condition reads,
#       never transmitted. A sender is a STATEMENT on its own line and never shares a line with
#       `if (`, so filtering `if (`-lines cannot mask a sender in this tree.
#   (b) DEPENDENCY-ARRAY entries — the sub inside a `[ ... ]` array literal (React effect/memo/
#       callback deps: `}, [user?.sub, selfUuid]);`). A re-render key, never transmitted; a sender
#       is never wrapped in `[...]`.
# The narrowing is by SHAPE (matching ci.yml's "allowlisted by construction"), not by file:line,
# so it does not silently rot when line numbers shift.
# ─────────────────────────────────────────────────────────────────────────────
C3=$(grep -rnE "${SUB}" "$SRC_DIR" 2>/dev/null | strip_comments \
  `# (a) drop presence/truthiness guards: the sub read on an if(...) condition line` \
  | grep -vE "\b(if|while|return)[[:space:]]*\(.*${SUB}" \
  `# (b) drop dependency-array entries: the sub inside a [ ... ] array literal` \
  | grep -vE "\[[^]]*${SUB}[^]]*\]" \
  || true)
if [ -n "$C3" ]; then
  echo "::FE-CENSUS-GATE FAIL:: unclassified \`*User?.sub\` reference outside the census §3 allowlist"
  echo "  (guards/dep-arrays are allowlisted; a surviving hit is most likely a re-introduced sender —"
  echo "   flip it to the resolved self UUID (useSelfIdentity's selfUuid/self.id), or add a reason to the allowlist):"
  echo "$C3"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "FE census-gate: FAIL — unsanctioned Auth0-sub sender(s) survive outside the census §3 allowlist."
  exit 1
fi

echo "FE census-gate: PASS — zero unsanctioned user.sub/authUser?.sub senders in ${SRC_DIR} outside the census §3 allowlist."
exit 0
