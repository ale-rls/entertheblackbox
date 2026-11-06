import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { syncWallPlayer, wallRotatedBox, wallViewFrame, type WallPlayback, type WallRegion } from './wall';

/** Correction loop interval; the start itself is scheduled to the millisecond. */
const SYNC_MS = 250;

/**
 * This tablet's part of the video wall, full screen behind the show-mode
 * controls. A pre-cut slice fills the screen; an uncut video (`region`) is
 * enlarged and shifted so only this tablet's region of the grid shows.
 * Preloaded and held on the first frame until `startAt` on the shared server
 * clock, then kept in step by `syncWallPlayer`.
 */
export function WallVideo({ uri, slot, region, rotation, startAt, loop, serverNow, onPlayback }: {
  uri: string;
  slot: string;
  /** For tablets mounted in landscape: the app stays portrait, the video turns. */
  rotation?: 0 | 90 | -90 | undefined;
  region?: WallRegion | undefined;
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
  const [screen, setScreen] = useState<{ width: number; height: number } | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const latest = useRef({ startAt, loop, serverNow, onPlayback });
  latest.current = { startAt, loop, serverNow, onPlayback };

  useEffect(() => { player.loop = loop; }, [player, loop]);

  useEffect(() => {
    const tick = () => {
      const { startAt: start, loop: looping, serverNow: now, onPlayback: report } = latest.current;
      // Duration is 0 until the file is loaded; keep holding the first frame until then.
      if (!(player.duration > 0)) return;
      // The real pixel size decides the crop of an uncut video; known once the track loads.
      const size = player.videoTrack?.size;
      if (size && size.width > 0 && size.height > 0) setVideoSize(current => current?.width === size.width && current.height === size.height ? current : { width: size.width, height: size.height });
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
  const box = screen ? wallRotatedBox(screen, rotation) : null;
  const frame = box ? wallViewFrame(region, slot, videoSize, box.screen) : null;
  // Before the start, the surface colour shows through; the player is already loaded.
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { opacity: startAt === null ? 0 : 1 }]}
    onLayout={event => { const { width, height } = event.nativeEvent.layout; setScreen({ width, height }); }}>
    {box && (!region || frame) && <View style={[styles.clip, { position: 'absolute', ...box.style }]}>
      <VideoView player={player} nativeControls={false} contentFit="fill" pointerEvents="none"
        style={frame ? { position: 'absolute', ...frame } : StyleSheet.absoluteFill} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden', backgroundColor: '#000000' } });
