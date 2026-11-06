import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { syncWallPlayer, type WallPlayback } from './wall';

/** Correction loop interval; the start itself is scheduled to the millisecond. */
const SYNC_MS = 250;

/**
 * This tablet's slice of the video wall, full screen behind the show-mode
 * controls. Preloaded and held on the first frame until `startAt` on the
 * shared server clock, then kept in step by `syncWallPlayer`.
 */
export function WallVideo({ uri, startAt, loop, serverNow, onPlayback }: {
  uri: string;
  startAt: number | null;
  loop: boolean;
  serverNow: () => number;
  onPlayback: (playback: WallPlayback) => void;
}) {
  const player = useVideoPlayer({ uri }, p => {
    p.muted = true;
    p.loop = loop;
    p.preservesPitch = false;
    p.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
  });
  const reported = useRef<WallPlayback | null>(null);
  const latest = useRef({ startAt, loop, serverNow, onPlayback });
  latest.current = { startAt, loop, serverNow, onPlayback };

  useEffect(() => { player.loop = loop; }, [player, loop]);

  useEffect(() => {
    const tick = () => {
      const { startAt: start, loop: looping, serverNow: now, onPlayback: report } = latest.current;
      // Duration is 0 until the file is loaded; keep holding the first frame until then.
      if (!(player.duration > 0)) return;
      const next = syncWallPlayer(player, start, looping, now());
      // Re-render the app only when something an operator would notice changed.
      const previous = reported.current;
      if (previous && previous.state === next.state && Math.abs((previous.driftMs ?? 0) - (next.driftMs ?? 0)) < 10) return;
      reported.current = next;
      report(next);
    };
    tick();
    const interval = setInterval(tick, SYNC_MS);
    // Fire exactly at the start instead of up to one interval late.
    const delay = startAt === null ? -1 : startAt - serverNow();
    const start = delay >= 0 && delay < 60_000 ? setTimeout(tick, delay) : undefined;
    return () => { clearInterval(interval); if (start) clearTimeout(start); };
  }, [player, startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Before the start, the surface colour shows through; the player is already loaded.
  return <VideoView player={player} nativeControls={false} contentFit="fill" pointerEvents="none"
    style={[StyleSheet.absoluteFill, { opacity: startAt === null ? 0 : 1 }]} />;
}
