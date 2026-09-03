import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DisplayToServerMessage, PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import { PhaseVideo } from "./PhaseVideo.js";

type VideoPhase = Extract<
  PhaseSnapshotMessage,
  { kind: "video" | "video-position-question" }
>;

export type PhaseVideoCandidate = {
  key: string;
  sessionId: string | null;
  phase: VideoPhase;
  phaseEpoch: number;
  src: string;
  extraAudioSrc?: string;
};

type Slot = 0 | 1;

/**
 * Retains the outgoing decoded frame until the incoming browser video has
 * actually presented a frame. The two stable slots are important: moving a
 * ready <video> between React branches would remount it and recreate the gap.
 */
export function PhaseVideoHandoff({
  desiredKey,
  candidate,
  soundEnabled,
  onVideoElement,
  onExtraAudioElement,
  onActiveKey,
  send,
}: {
  desiredKey: string | null;
  candidate: PhaseVideoCandidate | null;
  soundEnabled: boolean;
  onVideoElement?: (video: HTMLVideoElement | null) => void;
  onExtraAudioElement?: (audio: HTMLAudioElement | null) => void;
  onActiveKey?: (key: string) => void;
  send: (message: DisplayToServerMessage) => void;
}) {
  const [slots, setSlots] = useState<[PhaseVideoCandidate | null, PhaseVideoCandidate | null]>([
    null,
    null,
  ]);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);
  const activeSlotRef = useRef<Slot | null>(null);
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const audioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);

  useLayoutEffect(() => {
    const currentSlot = activeSlotRef.current;
    const current = currentSlot === null ? null : slots[currentSlot];

    if (desiredKey === null) {
      if (currentSlot !== null) {
        videoRefs.current[currentSlot]?.pause();
        audioRefs.current[currentSlot]?.pause();
        activeSlotRef.current = null;
        setActiveSlot(null);
        onVideoElement?.(null);
        onExtraAudioElement?.(null);
      }
      if (slots[0] !== null || slots[1] !== null) setSlots([null, null]);
      return;
    }

    if (current !== null && current.key !== desiredKey) {
      // Pause without removing the element: an ended/paused video continues to
      // paint its last decoded frame while the next Blob is prepared.
      videoRefs.current[currentSlot!]?.pause();
      audioRefs.current[currentSlot!]?.pause();
      onVideoElement?.(null);
      onExtraAudioElement?.(null);
    }

    if (candidate === null || candidate.key !== desiredKey || current?.key === candidate.key) {
      return;
    }

    const targetSlot: Slot = currentSlot === 0 ? 1 : 0;
    setSlots((previous) => {
      if (previous[targetSlot]?.key === candidate.key && previous[targetSlot]?.src === candidate.src) {
        return previous;
      }
      const next: [PhaseVideoCandidate | null, PhaseVideoCandidate | null] = [...previous];
      next[targetSlot] = candidate;
      return next;
    });
  }, [candidate, desiredKey, onExtraAudioElement, onVideoElement, slots]);

  const reveal = useCallback((slot: Slot, key: string) => {
    const current = slots[slot];
    if (current?.key !== key || key !== desiredKey) return;
    const previousSlot = activeSlotRef.current;
    activeSlotRef.current = slot;
    setActiveSlot(slot);
    onActiveKey?.(key);
    onVideoElement?.(videoRefs.current[slot]);
    onExtraAudioElement?.(audioRefs.current[slot]);
    if (previousSlot !== null && previousSlot !== slot) {
      videoRefs.current[previousSlot]?.pause();
      audioRefs.current[previousSlot]?.pause();
      setSlots((previous) => {
        const next: [PhaseVideoCandidate | null, PhaseVideoCandidate | null] = [...previous];
        next[previousSlot] = null;
        return next;
      });
    }
  }, [desiredKey, onActiveKey, onExtraAudioElement, onVideoElement, slots]);

  return <>
    {([0, 1] as const).map((slot) => {
      const value = slots[slot];
      if (value === null) return null;
      return (
        <div
          key={slot}
          className={`phase-video-slot${activeSlot === slot ? " phase-video-slot-active" : ""}`}
          data-phase-key={value.key}
        >
          <PhaseVideo
            sessionId={value.sessionId}
            phase={value.phase}
            phaseEpoch={value.phaseEpoch}
            src={value.src}
            {...(value.extraAudioSrc === undefined ? {} : { extraAudioSrc: value.extraAudioSrc })}
            soundEnabled={soundEnabled}
            onVideoElement={(video) => { videoRefs.current[slot] = video; }}
            onExtraAudioElement={(audio) => { audioRefs.current[slot] = audio; }}
            onFirstFrame={() => reveal(slot, value.key)}
            send={send}
          />
        </div>
      );
    })}
  </>;
}
