#!/usr/bin/env bash
# resume-work.sh — per-lane watchdog for the two-agent steps.md workflow.
# Contract agreed between claude and codex on 2026-07-11 (see steps.md, RESUME / WATCHDOG).
#
# Usage:  scripts/resume-work.sh claude|codex
#   Runs the given agent non-interactively, one step per invocation, in a loop:
#     - sentinel BACKLOG_STATUS: empty|blocked  -> lane done, exit 0
#     - clean exit + BACKLOG_STATUS: remaining  -> immediately run again
#     - quota/rate-limit failure               -> sleep (parsed reset time, else backoff), retry
#     - any other failure                      -> log and STOP the lane (never mark steps blocked)
#
# Run each lane independently (e.g. two launchd/cron entries) so one side being
# out of credits never stalls the other.

set -u

# RETIRED 2026-07-15: the steps.md workflow this watchdog drives was replaced
# by the PR-based flow in docs/agent-workflow.md. Exit immediately so a stale
# cron/launchd entry cannot spawn agents against the retired steps.md backlog.
echo "resume-work.sh is retired — the two-agent process moved to a PR-based flow (see docs/agent-workflow.md)." >&2
exit 0

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LANE="${1:-}"
[[ "$LANE" == "claude" || "$LANE" == "codex" ]] || { echo "usage: $0 claude|codex" >&2; exit 2; }

LOCK="$REPO/.watchdog/$LANE.lock"
LOGROOT="$REPO/.watchdog/logs/$LANE"
BACKOFF_MIN=60 BACKOFF_MAX=1800
backoff=$BACKOFF_MIN

PROMPT='You are the "'"$LANE"'" lane of the two-agent workflow in this repo.
Re-read steps.md and follow its protocol exactly. Recover your own unexpired
in-progress claim if one exists; otherwise claim the next unblocked todo step
that does not collide with the other agent. Perform AT MOST ONE step, update
its status and verification in steps.md under the .steps.lock protocol, then stop.
End your final message with exactly one line:
BACKLOG_STATUS: remaining|empty|blocked
(remaining = more unblocked steps exist; empty = backlog complete; blocked = only blocked steps remain).'

# --- per-lane process lock (mkdir is atomic) ---------------------------------
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another $LANE watchdog is running (lock: $LOCK) — exiting" >&2
  exit 0
fi
printf 'pid=%s\nstarted=%s\n' "$$" "$(date -u +%FT%TZ)" > "$LOCK/info"
trap 'rmdir "$LOCK" 2>/dev/null || rm -rf "$LOCK"' EXIT

quota_hit() { # conservative classifier over combined output
  grep -qiE 'usage limit|rate.?limit|quota|out of credits|insufficient credit|overloaded|429' "$1"
}

sleep_until_reset_or_backoff() { # opportunistic epoch parse, else exponential backoff
  local epoch now
  epoch="$(grep -oE '\|[0-9]{10}' "$1" | head -1 | tr -d '|')"
  now="$(date +%s)"
  if [[ -n "$epoch" && "$epoch" -gt "$now" && "$epoch" -lt $((now + 43200)) ]]; then
    echo "quota hit — sleeping until reset at $(date -r "$epoch")"
    sleep $((epoch - now + 60))
  else
    echo "quota hit — backing off ${backoff}s"
    sleep "$backoff"
    backoff=$((backoff * 2)); ((backoff > BACKOFF_MAX)) && backoff=$BACKOFF_MAX
  fi
}

while true; do
  run="$LOGROOT/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$run"
  echo "[$LANE] run: $run"

  if [[ "$LANE" == "codex" ]]; then
    codex exec --skip-git-repo-check --cd "$REPO" --sandbox workspace-write \
      --json --output-last-message "$run/final.txt" \
      "$PROMPT" >"$run/out.jsonl" 2>"$run/err.log"
    status=$?
    # terminal error events count as failure even on exit 0
    if [[ $status -eq 0 ]] && grep -qE '"type":"(error|turn\.failed)"' "$run/out.jsonl"; then
      status=1
    fi
  else
    claude -p --permission-mode acceptEdits \
      "$PROMPT" >"$run/final.txt" 2>"$run/err.log"
    status=$?
  fi

  cat "$run/final.txt" 2>/dev/null "$run/err.log" > "$run/combined.log"

  if [[ $status -eq 0 ]]; then
    backoff=$BACKOFF_MIN
    sentinel="$(grep -oE 'BACKLOG_STATUS: *(remaining|empty|blocked)' "$run/final.txt" | tail -1)"
    case "$sentinel" in
      *empty)   echo "[$LANE] backlog complete."; exit 0 ;;
      *blocked) echo "[$LANE] only blocked steps remain — stopping lane."; exit 0 ;;
      *remaining) continue ;;
      *) echo "[$LANE] no sentinel in final message — stopping lane to avoid blind looping." >&2; exit 1 ;;
    esac
  elif quota_hit "$run/combined.log"; then
    sleep_until_reset_or_backoff "$run/combined.log"
  else
    echo "[$LANE] non-quota failure (exit $status) — stopping lane. See $run" >&2
    exit 1
  fi
done
