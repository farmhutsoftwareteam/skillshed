#!/bin/sh
# Every check a change to main must pass. check.yml and sync-vendor.yml both
# run this, so a bot PR can't quietly skip one.
#
#   sh scripts/ci.sh [scan-report.md]
#
# Runs every check even after a failure, so the report shows all of them,
# then exits non-zero if any failed.
report=${1:-/dev/null}
failed=0
# With a report file, findings go there only, so callers' logs stay short.
scan_out=/dev/stdout
[ -n "$1" ] && scan_out=/dev/null

step() { echo "== $1"; }
fail() { echo "FAIL: $1"; failed=1; }

step "Lint skills, lock hashes, router index"
node scripts/check.mjs || fail "check.mjs"

step "Scan vendored skills for prompt injection"
node scripts/scan-skills.mjs --report "$report" > "$scan_out" || fail "scan-skills.mjs"

step "Scanner still catches a known-bad skill"
if node scripts/scan-skills.mjs tests/fixtures/injected-skill > /dev/null 2>&1; then
  fail "scanner passed tests/fixtures/injected-skill"
fi

step "Scan report keeps untrusted paths inside code spans"
node tests/report-escaping.test.mjs || fail "report-escaping.test.mjs"

exit $failed
