#!/usr/bin/env bash
# Serialize browser execution across the agm2 runners, without GitHub's
# pending-run replacement. This inode must be shared and must never be unlinked.
set -euo pipefail
runner_kind=${RUNNER_ENVIRONMENT:-}
case "$runner_kind" in
  self-hosted)
    # Host-local, independent of the runner's per-job RUNNER_TEMP. A missing
    # flock or inaccessible lock is an error, never an unlocked browser run.
    command -v flock >/dev/null || { echo 'flock not found; refusing unlocked browser execution.' >&2; exit 127; }
    umask 077
    # Keep the same open file description through every phase and teardown.
    exec 9>> /dev/shm/joedesk-browser.lock
    export JOED_BROWSER_LOCK_WAIT_STARTED_AT
    JOED_BROWSER_LOCK_WAIT_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    SECONDS=0
    waiting="Browser host lock: waiting since $JOED_BROWSER_LOCK_WAIT_STARTED_AT (limit 3600 seconds)."
    printf '%s\n' "$waiting"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$waiting" >> "$GITHUB_STEP_SUMMARY"; fi
    status=0
    flock --exclusive --wait 3600 --conflict-exit-code 75 9 || status=$?
    if [ "$status" -ne 0 ]; then
      failure="Browser host lock acquisition failed after $SECONDS seconds (exit $status; wait limit 3600 seconds); no browser phases started."
      echo "::error::$failure" >&2
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$failure" >> "$GITHUB_STEP_SUMMARY"; fi
      exit "$status"
    fi
    export JOED_BROWSER_LOCK_STATE=held JOED_BROWSER_LOCK_ACQUIRED_AT JOED_BROWSER_LOCK_WAIT_SECONDS
    JOED_BROWSER_LOCK_WAIT_SECONDS=$SECONDS
    JOED_BROWSER_LOCK_ACQUIRED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    ;;
  github-hosted)
    export JOED_BROWSER_LOCK_STATE=bypassed JOED_BROWSER_LOCK_WAIT_SECONDS=0
    export JOED_BROWSER_LOCK_WAIT_STARTED_AT='not required' JOED_BROWSER_LOCK_ACQUIRED_AT='not required'
    ;;
  *) echo 'Unknown runner environment; refusing browser execution.' >&2; exit 1 ;;
esac

evidence="Browser host lock ($JOED_BROWSER_LOCK_STATE): wait started $JOED_BROWSER_LOCK_WAIT_STARTED_AT; acquired $JOED_BROWSER_LOCK_ACQUIRED_AT; waited $JOED_BROWSER_LOCK_WAIT_SECONDS seconds."
printf '%s\n' "$evidence"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$evidence" >> "$GITHUB_STEP_SUMMARY"; fi
exec bash --noprofile --norc -e -o pipefail "$@"
