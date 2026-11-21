import type { ServerClock } from "@entertheblackbox/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DisplayToServerMessage, PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { PhaseImageAudio } from "./PhaseImageAudio.js";
import { PhaseVideo } from "./PhaseVideo.js";
import { fadeOutSkippedAudio } from "../media/skipFade.js";

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
  audioSrc?: string;
  extraAudioSrc?: string;
};

type Slot = 0 | 1;

/**
 * Retains the outgoing picture until the incoming image has loaded or its video
 * has presented a frame. A stable slot keeps the ready element mounted when
 * it replaces the outgoing picture. `revealAllowed` lets another layer (the
 * background loop) make the incoming picture wait so both change together, and
 * `holdOutgoing` keeps the last picture when no media is wanted until that
 * layer can cover it. An incoming still + MP3 revealed while it is set (its
 * sound must not wait) plays under the outgoing picture, which stays on top
 * until the hold ends.
 */
export function PhaseVideoHandoff({
  desiredKey,
  candidate,
  soundEnabled,
  clock,
  revealAllowed = true,
  holdOutgoing = false,
  onMediaElement,
  onExtraAudioElement,
  onActiveKey,
  onReadyKey,
  send,
}: {
  desiredKey: string | null;
  candidate: PhaseVideoCandidate | null;
  soundEnabled: boolean;
  clock?: ServerClock;
  revealAllowed?: boolean;
  holdOutgoing?: boolean;
  onMediaElement?: (media: HTMLMediaElement | null) => void;
  onExtraAudioElement?: (audio: HTMLAudioElement | null) => void;
  onActiveKey?: (key: string) => void;
  /** The key of the picture that could be on screen now: a framed incoming one, else the active one. */
  onReadyKey?: (key: string | null) => void;
  send: (message: DisplayToServerMessage) => void;
}) {
  const [slots, setSlots] = useState<[PhaseVideoCandidate | null, PhaseVideoCandidate | null]>([
    null,
    null,
  ]);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);
  const [framed, setFramed] = useState<[string | null, string | null]>([null, null]);
  const [heldSlot, setHeldSlot] = useState<Slot | null>(null);
  const holdOutgoingRef = useRef(holdOutgoing);
  const activeSlotRef = useRef<Slot | null>(null);
  const mediaRefs = useRef<[HTMLMediaElement | null, HTMLMediaElement | null]>([null, null]);
  const desiredKeyRef = useRef(desiredKey);
  const slotsRef = useRef(slots);
  const revealAllowedRef = useRef(revealAllowed);
  const audioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);

  useLayoutEffect(() => {
    desiredKeyRef.current = desiredKey;
    slotsRef.current = slots;
    revealAllowedRef.current = revealAllowed;
    holdOutgoingRef.current = holdOutgoing;
    const currentSlot = activeSlotRef.current;
    const current = currentSlot === null ? null : slots[currentSlot];

    if (desiredKey === null) {
      if (currentSlot !== null && holdOutgoing) {
        // Paused, the outgoing element keeps painting its last frame.
        fadeOutSkippedAudio(mediaRefs.current[currentSlot]);
        fadeOutSkippedAudio(audioRefs.current[currentSlot]);
        mediaRefs.current[currentSlot]?.pause();
        audioRefs.current[currentSlot]?.pause();
        onMediaElement?.(null);
        onExtraAudioElement?.(null);
        const other: Slot = currentSlot === 0 ? 1 : 0;
        if (slots[other] !== null) setSlots((previous) => withSlot(previous, other, null));
        return;
      }
      if (currentSlot !== null) {
        // Still sounding means the show moved on before the media ended: fade its audio out.
        fadeOutSkippedAudio(mediaRefs.current[currentSlot]);
        fadeOutSkippedAudio(audioRefs.current[currentSlot]);
        mediaRefs.current[currentSlot]?.pause();
        audioRefs.current[currentSlot]?.pause();
        activeSlotRef.current = null;
        setActiveSlot(null);
        onMediaElement?.(null);
        onExtraAudioElement?.(null);
      }
      if (slots[0] !== null || slots[1] !== null) setSlots([null, null]);
      return;
    }

    if (current !== null && current.key !== desiredKey) {
      // Pause without removing the element: an ended/paused video continues to
      // paint its last decoded frame while the next Blob is prepared. Audio that
      // is still sounding was skipped and fades out from a detached copy.
      fadeOutSkippedAudio(mediaRefs.current[currentSlot!]);
      fadeOutSkippedAudio(audioRefs.current[currentSlot!]);
      mediaRefs.current[currentSlot!]?.pause();
      audioRefs.current[currentSlot!]?.pause();
      onMediaElement?.(null);
      onExtraAudioElement?.(null);
    }

    if (candidate === null || candidate.key !== desiredKey || current?.key === candidate.key) {
      return;
    }

    const targetSlot: Slot = currentSlot === 0 ? 1 : 0;
    if (heldSlot === targetSlot) setHeldSlot(null);
    setSlots((previous) => {
      if (
        previous[targetSlot]?.key === candidate.key
        && previous[targetSlot]?.src === candidate.src
        && previous[targetSlot]?.audioSrc === candidate.audioSrc
        && previous[targetSlot]?.extraAudioSrc === candidate.extraAudioSrc
      ) {
        return previous;
      }
      const next: [PhaseVideoCandidate | null, PhaseVideoCandidate | null] = [...previous];
      next[targetSlot] = candidate;
      return next;
    });
  }, [candidate, desiredKey, heldSlot, holdOutgoing, onExtraAudioElement, onMediaElement, revealAllowed, slots]);

  // The held outgoing picture leaves once the other layer covers it.
  useLayoutEffect(() => {
    if (holdOutgoing || heldSlot === null) return;
    setHeldSlot(null);
    if (heldSlot !== activeSlotRef.current) setSlots((previous) => withSlot(previous, heldSlot, null));
  }, [heldSlot, holdOutgoing]);

  const reveal = useCallback((slot: Slot, candidate: PhaseVideoCandidate) => {
    const current = slotsRef.current[slot];
    if (current?.key !== candidate.key || current.src !== candidate.src || candidate.key !== desiredKeyRef.current) return;
    setFramed((previous) => previous[slot] === candidate.key ? previous : withSlot(previous, slot, candidate.key));
    if (!revealAllowedRef.current) return;
    const previousSlot = activeSlotRef.current;
    if (previousSlot === slot) return;
    activeSlotRef.current = slot;
    setActiveSlot(slot);
    onActiveKey?.(candidate.key);
    onMediaElement?.(mediaRefs.current[slot]);
    onExtraAudioElement?.(audioRefs.current[slot]);
    if (previousSlot !== null) {
      mediaRefs.current[previousSlot]?.pause();
      audioRefs.current[previousSlot]?.pause();
      if (holdOutgoingRef.current && candidate.audioSrc !== undefined) {
        // Paused, it keeps painting its last frame over the still until the hold ends.
        setHeldSlot(previousSlot);
        return;
      }
      setSlots((previous) => {
        const next: [PhaseVideoCandidate | null, PhaseVideoCandidate | null] = [...previous];
        next[previousSlot] = null;
        return next;
      });
    }
  }, [onActiveKey, onExtraAudioElement, onMediaElement]);

  // A picture that framed while the other layer was not ready is shown once it is.
  useLayoutEffect(() => {
    if (!revealAllowed || desiredKey === null) return;
    const slot = ([0, 1] as const).find((index) => framed[index] === desiredKey && slots[index]?.key === desiredKey);
    if (slot !== undefined && slot !== activeSlotRef.current) reveal(slot, slots[slot]!);
  }, [desiredKey, framed, reveal, revealAllowed, slots]);

  const framedSlot = ([0, 1] as const).find((index) => index !== activeSlot && index !== heldSlot
    && slots[index] !== null && framed[index] === slots[index]!.key);
  const readyKey = framedSlot !== undefined ? slots[framedSlot]!.key
    : activeSlot === null ? null : slots[activeSlot]?.key ?? null;
  useEffect(() => { onReadyKey?.(readyKey); }, [onReadyKey, readyKey]);

  return <>
    {([0, 1] as const).map((slot) => {
      const value = slots[slot];
      if (value === null) return null;
      return (
        <div
          key={slot}
          className={`phase-video-slot${activeSlot === slot ? " phase-video-slot-active" : ""}${
            heldSlot === slot ? " phase-video-slot-held" : ""}`}
          data-phase-key={value.key}
        >
          {value.audioSrc !== undefined ? <PhaseImageAudio
            key={value.key}
            sessionId={value.sessionId}
            phase={value.phase}
            phaseEpoch={value.phaseEpoch}
            imageSrc={value.src}
            audioSrc={value.audioSrc}
            soundEnabled={soundEnabled}
            {...(clock ? { clock } : {})}
            playbackEnabled={value.key === desiredKey}
            onAudioElement={(audio) => { mediaRefs.current[slot] = audio; }}
            onFirstFrame={() => reveal(slot, value)}
            send={send}
          /> : <PhaseVideo
            key={value.key}
            sessionId={value.sessionId}
            phase={value.phase}
            phaseEpoch={value.phaseEpoch}
            src={value.src}
            {...(value.extraAudioSrc === undefined ? {} : { extraAudioSrc: value.extraAudioSrc })}
            soundEnabled={soundEnabled}
            {...(clock ? { clock } : {})}
            playbackEnabled={value.key === desiredKey}
            onVideoElement={(video) => { mediaRefs.current[slot] = video; }}
            onExtraAudioElement={(audio) => { audioRefs.current[slot] = audio; }}
            onFirstFrame={() => reveal(slot, value)}
            send={send}
          />}
        </div>
      );
    })}
  </>;
}

function withSlot<T>(slots: [T, T], slot: Slot, value: T): [T, T] {
  const next: [T, T] = [...slots];
  next[slot] = value;
  return next;
}
