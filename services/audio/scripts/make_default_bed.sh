#!/bin/sh
# Default ambient bed: 2 min of quiet, low-passed brown noise (mono, 128k).
# Placeholder for show-authored beds — never leave a bed silent (SPEC §6):
# the bed is what keeps a locked phone's audio session alive between
# narration items.
set -eu
cd "$(dirname "$0")/.."
mkdir -p beds/default
ffmpeg -y -loglevel error \
    -f lavfi -i "anoisesrc=color=brown:duration=120:sample_rate=44100:amplitude=0.5" \
    -af "lowpass=f=400,volume=0.12,afade=t=in:d=2,afade=t=out:st=118:d=2" \
    -ac 1 -b:a 128k beds/default/bed.mp3
echo "wrote beds/default/bed.mp3"
