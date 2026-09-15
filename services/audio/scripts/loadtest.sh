#!/bin/sh
# Every listener must survive the full duration; early EOF is a test failure.
# N=100 BASE=http://localhost:8200 DURATION=600 ./scripts/loadtest.sh
set -eu
N="${N:-100}"
BASE="${BASE:-http://localhost:8200}"
DURATION="${DURATION:-600}"

case "$N" in ''|*[!0-9]*) echo "N must be a positive integer" >&2; exit 2;; esac
case "$DURATION" in ''|*[!0-9]*) echo "DURATION must be a positive integer" >&2; exit 2;; esac
[ "$N" -gt 0 ] && [ "$DURATION" -gt 0 ] || exit 2

echo "Checking $N continuous streams at $BASE for ${DURATION}s"
pids=""
results=$(mktemp -d "${TMPDIR:-/tmp}/blackbox-soak.XXXXXX")
trap 'rm -rf "$results"' EXIT
trap 'kill $pids 2>/dev/null || true; exit 130' INT TERM
i=1
while [ "$i" -le "$N" ]; do
    (
        code=0
        curl --fail --silent --show-error --connect-timeout 10 \
            --max-time "$DURATION" --speed-limit 1 --speed-time 15 \
            -o /dev/null -w '%{time_total} %{size_download}\n' \
            "$BASE/p/$i.mp3" > "$results/$i" 2>/dev/null || code=$?
        elapsed=0
        bytes=0
        read -r elapsed bytes < "$results/$i" || true
        rm -f "$results/$i"
        # curl 28 also covers connect/low-speed timeouts, so require elapsed
        # duration and nonempty audio as well. A clean early EOF returns 0.
        if [ "$code" -eq 28 ] && awk "BEGIN { exit !( $elapsed >= $DURATION - 0.1 && $bytes > 0 ) }"; then
            exit 0
        fi
        echo "FAIL mount=$i curl=$code elapsed=$elapsed bytes=$bytes" >&2
        exit 1
    ) &
    pids="$pids $!"
    i=$((i + 1))
done
failed=0
for pid in $pids; do
    wait "$pid" || failed=$((failed + 1))
done
[ "$failed" -eq 0 ] || { echo "$failed/$N streams failed" >&2; exit 1; }
echo "PASS: all $N streams stayed connected for ${DURATION}s"
