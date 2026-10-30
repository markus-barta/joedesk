#!/usr/bin/env bash
# Serialize browser execution across the agm2 runners, without GitHub's
# pending-run replacement. This inode must be shared and must never be unlinked.
set -euo pipefail
runner_kind=${RUNNER_ENVIRONMENT:-}
case "$runner_kind" in
  self-hosted)
    # Host-local, independent of the runner's per-job RUNNER_TEMP. A missing
    # flock or inaccessible lock is an error, never an unlocked browser run.
    umask 077
    exec flock --exclusive /dev/shm/joedesk-browser.lock \
      bash --noprofile --norc -e -o pipefail "$@"
    ;;
  github-hosted)
    exec bash --noprofile --norc -e -o pipefail "$@"
    ;;
  *) echo 'Unknown runner environment; refusing browser execution.' >&2; exit 1 ;;
esac
