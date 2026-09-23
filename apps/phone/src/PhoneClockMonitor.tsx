import { useEffect, useState, type MutableRefObject } from "react";
import { PROTOCOL_VERSION, type ClockTiming } from "@entertheblackbox/protocol";
import type { PhoneConnection } from "./lib/connection.js";
import type { SynchronizedAudio } from "./lib/synchronized-audio.js";
import type { PhoneState } from "./state/store.js";

export function phoneTiming(connection: PhoneConnection, state: PhoneState, read: (() => ReturnType<SynchronizedAudio["getTiming"]>) | null): ClockTiming {
  const clock = connection.clock;
  const audio = read?.();
  const key = `${state.sessionId}:${state.routingEpoch}:${state.phaseEpoch}`;
  return { calibrated: clock.hasSamples, offsetMs: clock.offset, roundTripMs: clock.roundTripMs, sampleAgeMs: clock.sampleAgeMs(),
    elapsedMs: state.phaseTiming ? clock.now() - state.phaseTiming.startedAt : 0,
    mode: state.synchronizedPhase ? "synchronized" : state.phoneAudioActive ? "stream" : "none",
    media: state.synchronizedPhase ? audio?.cueKey === key ? audio.media : [{ role: "main", positionMs: null, targetMs: null, driftMs: null, state: "loading" }] : [] };
}

export function PhoneClockMonitor({ connection, state, timingRef }: {
  connection: PhoneConnection; state: PhoneState; timingRef: MutableRefObject<(() => ReturnType<SynchronizedAudio["getTiming"]>) | null>;
}) {
  const [timing, setTiming] = useState(() => phoneTiming(connection, state, timingRef.current));
  useEffect(() => {
    const update = () => {
      const next = phoneTiming(connection, state, timingRef.current);
      setTiming(next);
      if (state.join.kind === "accepted" && state.sessionId && state.currentPhaseId) connection.send({
        t: "ping", v: PROTOCOL_VERSION, clientTime: Date.now(), timing: {
          sessionId: state.sessionId, phaseId: state.currentPhaseId, phaseEpoch: state.phaseEpoch, routingEpoch: state.routingEpoch, timing: next,
        },
      });
    };
    update(); const timer = setInterval(update, 2000);
    return () => clearInterval(timer);
  }, [connection, state.sessionId, state.currentPhaseId, state.phaseEpoch, state.routingEpoch, state.join.kind, state.phoneAudioActive, state.phaseTiming?.startedAt, timingRef]);
  return <details className="phone-clock-monitor" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    <summary>Show timing · {state.join.kind !== "accepted" ? "disconnected" : timing.calibrated && (timing.sampleAgeMs ?? Infinity) < 30000 ? "clock measured" : "clock waiting"}</summary>
    <p>{state.currentGroup?.label ?? "Shared"} · {state.currentPhaseId} · cue {(timing.elapsedMs / 1000).toFixed(1)} s</p>
    <p>Server UTC {connection.clock.ready ? new Date(connection.clock.now()).toISOString().slice(11, 23) : "waiting"} · sample age {timing.sampleAgeMs === null ? "—" : `${Math.round(timing.sampleAgeMs / 1000)} s`}</p>
    <p>Offset {Math.round(timing.offsetMs)} ms · round trip {timing.roundTripMs ?? "—"} ms</p>
    {timing.media.map((media) => <p key={media.role}>Audio {media.state} · position {media.positionMs === null ? "—" : (media.positionMs / 1000).toFixed(2) + " s"} · drift {media.driftMs === null ? "not measured" : Math.round(media.driftMs) + " ms"}</p>)}
    {timing.mode === "stream" && <p>Stream audio: cue drift is not measurable. Browser buffering adds latency.</p>}
    {timing.mode === "none" && <p>No timed phone audio in this cue.</p>}
    <p>Updates every 2 seconds. Audio positions are browser estimates, not a measurement of sound at the headphones.</p>
  </details>;
}
