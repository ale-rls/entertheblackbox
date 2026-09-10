#!/bin/sh
# T2 load test (SPEC §10): N concurrent headless listeners across mounts.
#   N=100 BASE=http://localhost:8200 DURATION=7200 ./scripts/loadtest.sh
set -eu
N="${N:-100}"
BASE="${BASE:-http://localhost:8200}"
DURATION="${DURATION:-600}"

echo "spawning $N listeners against $BASE for ${DURATION}s"
pids=""
i=1
while [ "$i" -le "$N" ]; do
    curl -s --max-time "$DURATION" -o /dev/null "$BASE/p/$i.mp3" &
    pids="$pids $!"
    i=$((i + 1))
done

trap 'kill $pids 2>/dev/null || true' INT TERM
wait $pids || true
echo "done"
