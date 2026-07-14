import { useState } from "react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { advancePreview, advanceTimer, continueAfterResolution, currentPhase, forcedOutcomes, resolvePreview, startPreview, type ForcedOutcome, type PreviewSession } from "./preview.js";

export function PreviewPanel({ project, onClose }: { project: StudioProject; onClose: () => void }) {
  const [session, setSession] = useState<PreviewSession>(() => startPreview(project));
  const [includeStale, setIncludeStale] = useState(true);
  const [includeDisconnected, setIncludeDisconnected] = useState(true);
  const phase = currentPhase(session);
  const force = (outcome: ForcedOutcome) => setSession((value) => resolvePreview(value, outcome, includeStale, includeDisconnected));
  const outcomes: ForcedOutcome[] = phase.kind === "position-question"
    ? phase.next.type === "fixed"
      ? [phase.field.type === "two-quadrant" ? "max" : "q4"]
      : forcedOutcomes(phase.field)
    : [];
  return <main className="preview-shell" data-sc-tool-density="compact" data-sc-tool-root><section className="preview" aria-label="Show preview"><header><div><p className="sc-tool-eyebrow">Simulation</p><h2>Outcome preview</h2></div><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={onClose}>Close preview</button></header>
    <p><strong>{phase.id}</strong> · {phase.kind} · manual time {session.elapsedMs} ms</p><p>{session.validation.length} validation diagnostic(s) checked before preview.</p>
    {phase.kind === "video" && <><p>Video placeholder: {phase.src}</p><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => setSession((value) => advanceTimer(value, phase.expectedDurationMs))}>Advance expected timer</button><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => setSession(advancePreview)}>Next phase</button></>}
    {phase.kind === "idle" && <p>Idle/end phase reached.</p>}
    {phase.kind === "position-question" && <><p>{phase.text}</p><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => setSession((value) => advanceTimer(value, phase.durationMs))}>Advance question timer</button><label className="sc-tool-checkbox"><input type="checkbox" checked={includeStale} onChange={(event) => setIncludeStale(event.target.checked)} /> Include stale</label><label className="sc-tool-checkbox"><input type="checkbox" checked={includeDisconnected} onChange={(event) => setIncludeDisconnected(event.target.checked)} /> Include disconnected</label><div className="preview-outcomes">{outcomes.map((outcome) => <button className="sc-tool-button" data-sc-tool-variant="secondary" key={outcome} onClick={() => force(outcome)}>{phase.next.type === "fixed" ? "Resolve fixed" : `Force ${outcome}`}</button>)}</div></>}
    {session.resolution && <article className="preview-result"><h3>Frozen result ({session.resolution.freezeMs} ms)</h3><p>Winner: <strong>{session.resolution.winner}</strong> → {session.resolution.resolvedTarget}</p><p>Counted {session.resolution.includedTotal}; excluded {session.resolution.excludedTotal}</p><pre>{JSON.stringify({ quadrantCounts: session.resolution.quadrantCounts, includedByStatus: session.resolution.includedByStatus, excludedByStatus: session.resolution.excludedByStatus, votes: session.resolution.votes }, null, 2)}</pre><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => setSession(continueAfterResolution)}>Continue to resolved target</button></article>}
  </section></main>;
}
