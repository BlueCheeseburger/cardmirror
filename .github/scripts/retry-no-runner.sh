#!/usr/bin/env bash
# Re-runs the failed jobs of a CI or Release run when every one of them was
# cancelled because GitHub never found a hosted runner for it, at most until
# the run reaches MAX_ATTEMPTS. Used by .github/workflows/retry-no-runner.yml.
#
# A job counts as "never got a runner" only when it was cancelled, ran no
# steps, and carries GitHub's annotation "The job was not acquired by Runner
# of type hosted". Anything else that failed (a test, a build step, a timeout,
# a run someone cancelled by hand) means no retry.
#
# Env: REPO (owner/name), RUN_ID, MAX_ATTEMPTS (default 3), GH_TOKEN.
# DRY_RUN=1 only prints what it would do (for checking it against old runs).
set -euo pipefail

: "${REPO:?}" "${RUN_ID:?}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
POLL="${POLL_SECONDS:-30}"

run_field() { gh api "repos/$REPO/actions/runs/$RUN_ID" --jq "$1"; }

wait_until_completed() {
  while [ "$(run_field .status)" != "completed" ]; do sleep "$POLL"; done
}

# Prints "retry" if every failed job of this attempt never got a runner,
# "none" if nothing failed, else "stop".
classify_attempt() {
  local attempt="$1" jobs failed id
  jobs=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$attempt/jobs?per_page=100" \
    --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")
                  | [.id, .conclusion, (.steps | length), .name] | @tsv')
  if [ -z "$jobs" ]; then echo none; return; fi
  while IFS=$'\t' read -r id conclusion steps name; do
    if [ "$conclusion" != "cancelled" ] || [ "$steps" != "0" ]; then
      echo "Job \"$name\" ended $conclusion after running steps; not a runner problem." >&2
      echo stop; return
    fi
    if ! gh api "repos/$REPO/check-runs/$id/annotations" --jq '.[].message' \
         | grep -q "was not acquired by Runner"; then
      echo "Job \"$name\" was cancelled without GitHub's no-runner note; leaving it." >&2
      echo stop; return
    fi
    echo "Job \"$name\" never got a runner." >&2
  done <<< "$jobs"
  echo retry
}

while true; do
  wait_until_completed
  attempt=$(run_field .run_attempt)
  verdict=$(classify_attempt "$attempt")
  case "$verdict" in
    none) echo "Attempt $attempt: nothing failed."; exit 0 ;;
    stop) echo "Attempt $attempt: a real failure, not retrying."; exit 0 ;;
  esac
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::warning::Run $RUN_ID still had no macOS runner after $attempt attempts. Re-run it by hand later."
    exit 0
  fi
  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "Attempt $attempt: would re-run the failed jobs."; exit 0
  fi
  echo "Attempt $attempt: re-running the failed jobs (attempt $((attempt + 1)) of at most $MAX_ATTEMPTS)."
  gh run rerun "$RUN_ID" --failed --repo "$REPO"
  # Wait for GitHub to register the new attempt before polling for completion.
  until [ "$(run_field .run_attempt)" -gt "$attempt" ]; do sleep 10; done
done
