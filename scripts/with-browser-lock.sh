#!/usr/bin/env bash
# Serialize browser execution across the agm2 runners, without GitHub's
# pending-run replacement. This inode must be shared and must never be unlinked.
set -euo pipefail
export JOED_BROWSER_LOCK_REASON=''
export JOED_BROWSER_LOCK_WAIT_STARTED_AT=unavailable JOED_BROWSER_LOCK_ACQUIRED_AT=unavailable JOED_BROWSER_LOCK_WAIT_SECONDS=0

lock_unavailable() {
  export JOED_BROWSER_LOCK_STATE=unavailable JOED_BROWSER_LOCK_REASON="$1"
  local warning="Browser host lock unavailable ($JOED_BROWSER_LOCK_REASON); running UNLOCKED, timing budgets may contend"
  printf '::warning::%s\n' "$warning" >&2
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$warning" >> "$GITHUB_STEP_SUMMARY"; fi
}

runner_kind=${RUNNER_ENVIRONMENT:-}
case "$runner_kind" in
  self-hosted)
    # Host-local, independent of the runner's per-job RUNNER_TEMP. Infrastructure
    # failures degrade visibly; actual contention still has a hard wait bound.
    umask 077
    if ! command -v flock >/dev/null; then
      lock_unavailable 'flock not found'
    # Keep the same open file description through every phase and teardown.
    elif ! { exec 9>> /dev/shm/joedesk-browser.lock; }; then
      lock_unavailable 'cannot open /dev/shm/joedesk-browser.lock'
    else
      JOED_BROWSER_LOCK_WAIT_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      SECONDS=0
      waiting="Browser host lock: waiting since $JOED_BROWSER_LOCK_WAIT_STARTED_AT (limit 3600 seconds)."
      printf '%s\n' "$waiting"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$waiting" >> "$GITHUB_STEP_SUMMARY"; fi
      status=0
      flock --exclusive --wait 3600 --conflict-exit-code 75 9 || status=$?
      JOED_BROWSER_LOCK_WAIT_SECONDS=$SECONDS
      if [ "$status" -eq 75 ]; then
        failure="Browser host lock acquisition failed after $JOED_BROWSER_LOCK_WAIT_SECONDS seconds (exit $status; wait limit 3600 seconds); no browser phases started."
        echo "::error::$failure" >&2
        if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$failure" >> "$GITHUB_STEP_SUMMARY"; fi
        exit "$status"
      elif [ "$status" -ne 0 ]; then
        exec 9>&-
        lock_unavailable "flock failed (exit $status)"
      else
        export JOED_BROWSER_LOCK_STATE=held
        JOED_BROWSER_LOCK_ACQUIRED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      fi
    fi
    ;;
  github-hosted)
    export JOED_BROWSER_LOCK_STATE=bypassed JOED_BROWSER_LOCK_WAIT_SECONDS=0
    export JOED_BROWSER_LOCK_WAIT_STARTED_AT='not required' JOED_BROWSER_LOCK_ACQUIRED_AT='not required'
    ;;
  *) echo 'Unknown runner environment; refusing browser execution.' >&2; exit 1 ;;
esac

evidence="Browser host lock ($JOED_BROWSER_LOCK_STATE): wait started $JOED_BROWSER_LOCK_WAIT_STARTED_AT; acquired $JOED_BROWSER_LOCK_ACQUIRED_AT; waited $JOED_BROWSER_LOCK_WAIT_SECONDS seconds."
if [ -n "$JOED_BROWSER_LOCK_REASON" ]; then evidence="$evidence Reason: $JOED_BROWSER_LOCK_REASON."; fi
printf '%s\n' "$evidence"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$evidence" >> "$GITHUB_STEP_SUMMARY"; fi
exec bash --noprofile --norc -e -o pipefail "$@"
