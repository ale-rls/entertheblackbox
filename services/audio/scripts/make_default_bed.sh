#!/bin/sh
# Default bed: continuous silent MP3 frames between narration items.
# Show-authored beds can still be selected through the bridge.
set -eu
cd "$(dirname "$0")/.."
mkdir -p beds/default
ffmpeg -y -loglevel error \
    -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=44100" \
    -t 120 -ac 1 -b:a 128k beds/default/bed.mp3
echo "wrote beds/default/bed.mp3"
