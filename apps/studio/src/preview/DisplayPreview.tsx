import { useEffect, useMemo, useRef, useState } from "react";
import PocketBase from "pocketbase";
import type { QuestionResolvedMessage } from "../../../../packages/protocol/src/index.js";
import type { PhaseSnapshot } from "../../../../packages/scenario/src/index.js";
import { QuadrantOverlay } from "../../../display/src/components/QuadrantOverlay.js";
import { VideoQuestionOverlay } from "../../../display/src/components/VideoQuestionOverlay.js";
import { ServerClock } from "../../../display/src/lib/serverClock.js";
import { advancePreview, continueAfterResolution, currentPhase, forcedOutcomes, resolvePreview, startPreview, type ForcedOutcome, type PreviewResolution } from "./preview.js";
import type { ProjectPreview } from "./project-preview.js";
import "../../../display/src/style.css";
import "./display-preview.css";

declare const __POCKETBASE_URL__: string;

type MediaRecord = { id: string; src: string; file?: string };

const serverMediaUrl = (src: string) => `/media/${src.split("/").map(encodeURIComponent).join("/")}`;

async function resolveMediaUrls(sources: string[]): Promise<Record<string, string>> {
  const fallback = Object.fromEntries(sources.map((src) => [src, serverMediaUrl(src)]));
  try {
    const pb = new PocketBase(__POCKETBASE_URL__);
    const records = await pb.collection<MediaRecord>("media").getFullList();
    const wanted = new Set(sources);
    for (const record of records) {
      if (wanted.has(record.src) && record.file) fallback[record.src] = pb.files.getURL(record, record.file);
    }
  } catch {
    // The bundled server's /media route remains a valid fallback when
    // PocketBase is unavailable or Studio is being viewed offline.
  }
  return fallback;
}

function snapshotFor(phase: ReturnType<typeof currentPhase>, scenarioVersion: string, startedAt: number): PhaseSnapshot {
  const deadlineAt = phase.kind === "position-question"
    ? startedAt + phase.durationMs
    : phase.kind === "video" || phase.kind === "video-position-question"
      ? startedAt + phase.expectedDurationMs
      : null;
  return { ...phase, scenarioVersion, startedAt, deadlineAt } as PhaseSnapshot;
}

function resolutionMessage(resolution: PreviewResolution | undefined, phaseEpoch: number): QuestionResolvedMessage | null {
  if (resolution === undefined) return null;
  return {
    t: "question_resolved",
    v: 2,
    sessionId: "studio-preview",
    phaseEpoch,
    resolvedTarget: resolution.resolvedTarget,
    freezeUntil: Date.now() + resolution.freezeMs,
    field: resolution.field,
    quadrantCounts: resolution.quadrantCounts,
    winner: resolution.winner,
    ...(resolution.tieBreak === undefined ? {} : { tieBreak: resolution.tieBreak }),
  } as QuestionResolvedMessage;
}

function outcomeTarget(phase: Extract<ReturnType<typeof currentPhase>, { kind: "position-question" | "video-position-question" }>, outcome: ForcedOutcome): string {
  if (phase.next.type === "fixed") return phase.next.target;
  if (outcome === "tie") return phase.next.tie;
  if (outcome === "empty") return phase.next.empty;
  return (phase.next.map as Record<string, string>)[outcome] ?? phase.next.empty;
}

export function DisplayPreview({ preview }: { preview: ProjectPreview }) {
  const [session, setSession] = useState(() => startPreview(preview.project, preview.startPhaseId));
  const [phaseStartedAt, setPhaseStartedAt] = useState(() => Date.now());
  const [phaseEpoch, setPhaseEpoch] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clock = useMemo(() => new ServerClock(), []);
  const phase = currentPhase(session);
  const snapshot = snapshotFor(phase, preview.project.scenario.version, phaseStartedAt);
  const resolution = resolutionMessage(session.resolution, phaseEpoch);

  useEffect(() => {
    const sources = preview.project.manifest.files.map((file) => file.src);
    void resolveMediaUrls(sources).then(setMediaUrls);
  }, [preview.project]);
  useEffect(() => () => {
    if (tailTimer.current !== null) clearTimeout(tailTimer.current);
  }, []);

  const move = (next: typeof session) => {
    if (tailTimer.current !== null) {
      clearTimeout(tailTimer.current);
      tailTimer.current = null;
    }
    setSession(next);
    setPhaseStartedAt(Date.now());
    setPhaseEpoch((value) => value + 1);
  };
  const advance = () => move(advancePreview(session));
  const completeMediaPhase = () => {
    if (phase.kind === "video") {
      advance();
      return;
    }
    if (phase.kind === "video-position-question" && phase.next.type === "fixed") advance();
  };
  const finishMedia = () => {
    const tailDurationMs = phase.kind === "video" || phase.kind === "video-position-question"
      ? phase.tailDurationMs ?? 0
      : 0;
    if (tailDurationMs === 0) {
      completeMediaPhase();
      return;
    }
    if (tailTimer.current !== null) clearTimeout(tailTimer.current);
    tailTimer.current = setTimeout(() => {
      tailTimer.current = null;
      completeMediaPhase();
    }, tailDurationMs);
  };
  const enableSound = () => {
    setSoundEnabled(true);
    if (videoRef.current) {
      videoRef.current.muted = false;
      void videoRef.current.play().catch(() => undefined);
    }
    if (audioRef.current) {
      audioRef.current.muted = false;
      void audioRef.current.play().catch(() => undefined);
    }
  };
  const restart = () => {
    move(startPreview(preview.project, preview.startPhaseId));
  };
  const votePhase = phase.kind === "position-question" || phase.kind === "video-position-question" ? phase : null;
  const outcomes = votePhase === null
    ? []
    : votePhase.next.type === "fixed"
      ? [votePhase.field.type === "two-quadrant" ? "max" : votePhase.field.type === "polygon-zones" ? votePhase.field.zones[0]!.id : "q4"] as ForcedOutcome[]
      : forcedOutcomes(votePhase.field).filter((outcome) => outcome !== "abandoned-solo");
  const visualUrl = (phase.kind === "video" || phase.kind === "video-position-question") ? mediaUrls[phase.src] ?? serverMediaUrl(phase.src) : null;
  const audioUrl = (phase.kind === "video" || phase.kind === "video-position-question") && phase.audioSrc ? mediaUrls[phase.audioSrc] ?? serverMediaUrl(phase.audioSrc) : null;

  return <main className="display-root studio-display-preview">
    <section className="layer layer-video">
      {(snapshot.kind === "video" || snapshot.kind === "video-position-question") && snapshot.audioSrc === undefined && visualUrl && <video ref={videoRef} key={`${phaseEpoch}:${snapshot.id}`} src={visualUrl} autoPlay muted={!soundEnabled} playsInline onEnded={finishMedia} />}
      {(snapshot.kind === "video" || snapshot.kind === "video-position-question") && snapshot.audioSrc !== undefined && visualUrl && audioUrl && <div className="phase-image-audio"><img src={visualUrl} alt="" /><audio ref={audioRef} key={`${phaseEpoch}:${snapshot.id}`} src={audioUrl} autoPlay muted={!soundEnabled} onEnded={finishMedia} /></div>}
    </section>
    <section className="layer layer-ui">
      {snapshot.kind === "idle" && <div className="preview-idle"><span>Idle / end</span></div>}
      {snapshot.kind === "position-question" && <div className="question"><div className="question-copy"><p className="question-text">{snapshot.text}</p></div><QuadrantOverlay field={snapshot.field} liveField={null} liveCounts={null} resolution={resolution} /></div>}
      {snapshot.kind === "video" && snapshot.title && <div className="video-title">{snapshot.title}</div>}
      {snapshot.kind === "video-position-question" && <VideoQuestionOverlay phase={snapshot} clock={clock} liveField={null} liveCounts={null} resolution={resolution} />}
    </section>
    <aside className="preview-controls" aria-label="Preview controls">
      <div className="preview-context"><span className="preview-badge">Studio preview</span><strong>{preview.draftName}</strong><span>{phase.id}</span></div>
      {!soundEnabled && (phase.kind === "video" || phase.kind === "video-position-question") && <button type="button" onClick={enableSound}>Enable sound</button>}
      {phase.kind === "video" && <button type="button" onClick={advance}>Next phase</button>}
      {votePhase && session.resolution === undefined && outcomes.map((outcome) => <button type="button" key={outcome} onClick={() => setSession(resolvePreview(session, outcome))}>{votePhase.next.type === "fixed" ? "Preview fixed outcome" : `Preview ${outcome} → ${outcomeTarget(votePhase, outcome)}`}</button>)}
      {session.resolution && <button type="button" onClick={() => move(continueAfterResolution(session))}>Continue to {session.resolution.resolvedTarget}</button>}
      <button type="button" onClick={restart}>Restart from {preview.startPhaseId}</button>
      <button type="button" onClick={() => window.close()}>Close</button>
    </aside>
  </main>;
}
