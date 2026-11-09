import { ParticipantTaskCard } from "./ParticipantTaskCard.js";
import { rehearsalId, runtimeApi, runtimeWebSocket } from "@entertheblackbox/protocol";
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION } from "@entertheblackbox/protocol";
import { PhoneConnection, type EndedPhoneSession } from "./lib/connection.js";
import { RealtimeCursorPublisher } from "./lib/realtimeWsClient.js";
import { loadLease } from "./lib/lease.js";
import {
  applyDelta,
  InputThrottle,
  TRACKPAD_CENTER,
  trackpadSurfaceSize,
  type TrackpadState,
} from "./lib/trackpad.js";
import { initialPhoneState, phoneReducer } from "./state/store.js";

/**
 * Phone controller (plan §10): fullscreen relative trackpad, small
 * identity marker, minimal connection indicator, and current scene text.
 * The phone does not mirror the vote or countdown — participants still look
 * up at the projection for the shared interaction.
 */

declare const __BUILD_VERSION__: string | undefined;
declare const __REALTIME_WS_URL__: string | undefined;

const baseConfig = {
  url: runtimeWebSocket(location),
  clientVersion:
    typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "0.0.0-dev",
  realtimeWsUrl:
    typeof __REALTIME_WS_URL__ === "string" ? __REALTIME_WS_URL__ : "ws://localhost:9001",
};

type JoinConfig = { installationId: string; roomId: string };
type ConsentStatus = "prompt" | "submitting" | "granted" | "deleted";
type ConsentState = {
  session: EndedPhoneSession;
  deadlineAt: number;
  status: ConsentStatus;
  error: string | null;
};

const CONSENT_TIMEOUT_MS = 60_000;

const cursorTransform = (value: TrackpadState, surfaceSizePx: number): string =>
  `translate3d(${value.x * surfaceSizePx}px, ${value.y * surfaceSizePx}px, 0) translate3d(-50%, -50%, 0)`;

function loadParticipantName(): string {
  try { return localStorage.getItem("participant-name") ?? ""; }
  catch { return ""; }
}

function storeParticipantName(name: string): void {
  try { localStorage.setItem("participant-name", name); }
  catch { /* Joining still works when browser storage is unavailable. */ }
}

const REJECTION_TEXT: Record<string, string> = {
  update_required: "This show requires the native app. Please ask the entrance team for help joining.",
  expired_grant: "This code has expired — scan the QR on the screen again.",
  room_full: "The room is full right now. Watch the screen and try again soon.",
  rate_limited: "Connection retries paused briefly. Reconnecting automatically…",
  show_in_progress: "The show is in progress — wait for the next round.",
};

export function App() {
  const [state, dispatch] = useReducer(phoneReducer, initialPhoneState);
  const [name, setName] = useState(loadParticipantName);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [joinConfig, setJoinConfig] = useState<JoinConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const identity = state.join.kind === "accepted" ? state.join.identity : null;
  const position = useRef<TrackpadState>({ ...TRACKPAD_CENTER });
  const cursorSurfaceSize = useRef(trackpadSurfaceSize(window.innerWidth, window.innerHeight));
  const cursorMarker = useRef<HTMLSpanElement | null>(null);
  const cursorPaintFrame = useRef<number | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const seq = useRef(0);
  const throttle = useMemo(() => new InputThrottle(), []);
  const realtimeWs = useRef<RealtimeCursorPublisher | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(runtimeApi("/api/join-config"))
      .then(async (response) => {
        if (!response.ok) throw new Error(`Join service unavailable (${response.status})`);
        const value = await response.json() as JoinConfig;
        if (!cancelled) {
          setJoinConfig(value);
          const savedName = loadParticipantName().trim();
          if (savedName && loadLease(value.installationId) !== null) setSubmittedName(savedName);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setConfigError(error instanceof Error ? error.message : "Join service unavailable");
      });
    return () => { cancelled = true; };
  }, []);

  const connection = useMemo(
    () => submittedName === null || joinConfig === null
      ? null
      : new PhoneConnection({
        ...baseConfig,
        ...joinConfig,
        name: submittedName,
        onMessage: (message) => {
          // This server response requests native-only workflows, not a new web bundle.
          // The following update_required rejection explains how to join.
          if (message.t === "reload" && message.minVersion.startsWith("Update the native app")) return;
          dispatch({ type: "server-message", message, receivedAtMs: Date.now() });
        },
        onSocketOpen: () => dispatch({ type: "socket-open" }),
        onSocketLost: () => dispatch({ type: "socket-lost" }),
        onSessionEnded: (session) => {
          if (rehearsalId()) return;
          if (session !== null && session.sessionId !== "idle" && session.sessionId !== "lobby") {
            setConsent({ session, deadlineAt: Date.now() + CONSENT_TIMEOUT_MS, status: "prompt", error: null });
          } else {
            setSubmittedName(null);
          }
          dispatch({ type: "session-ended" });
        },
      }),
    [joinConfig, submittedName],
  );

  useEffect(() => {
    if (connection === null) return;
    connection.start();
    return () => connection.stop();
  }, [connection]);

  useEffect(() => () => {
    if (cursorPaintFrame.current !== null) {
      window.cancelAnimationFrame(cursorPaintFrame.current);
    }
  }, []);

  const join = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || joinConfig === null) return;
    storeParticipantName(cleanName);
    dispatch({ type: "reset" });
    setSubmittedName(cleanName);
  };

  const tryAgain = () => {
    connection?.stop();
    setSubmittedName(null);
    dispatch({ type: "reset" });
  };

  // Low-latency cursor overlay (apps/realtime-ws-coolify): additive to the "input"
  // message sent over the main connection above, published once this
  // phone's server-assigned identity (clientId + color) is known so the
  // display renders it with the same color everywhere.
  useEffect(() => {
    if (identity === null) return;
    const publisher = new RealtimeCursorPublisher({
      url: baseConfig.realtimeWsUrl,
      room: `${joinConfig?.installationId ?? ""}:${joinConfig?.roomId ?? ""}`,
      clientId: identity.clientId,
      color: identity.color,
    });
    realtimeWs.current = publisher;
    publisher.start();
    return () => {
      publisher.stop();
      realtimeWs.current = null;
    };
  }, [identity?.clientId, identity?.color, joinConfig?.installationId, joinConfig?.roomId]);

  useEffect(() => {
    if (state.reloadRequired) {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker?.getRegistrations();
          await Promise.allSettled((regs ?? []).map((r) => r.update()));
        } catch {
          // reload regardless
        }
        location.reload();
      })();
    }
  }, [state.reloadRequired]);

  useEffect(() => {
    // Once the user has answered ("submitting"), only the fetch's own
    // outcome may decide the final state -- otherwise an answer that lands
    // near the deadline reschedules this fallback at ~0ms and can flip a
    // just-submitted "granted" straight to "deleted" before the request
    // resolves.
    if (consent === null || consent.status !== "prompt") return;
    const timer = window.setTimeout(() => {
      setConsent((current) => current !== null && current.status === "prompt"
        ? { ...current, status: "deleted", error: null }
        : current);
    }, Math.max(0, consent.deadlineAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [consent?.deadlineAt, consent?.status]);

  const submitConsent = async (granted: boolean) => {
    if (consent === null || consent.status === "submitting") return;
    const session = consent.session;
    setConsent((current) => current === null ? null : { ...current, status: "submitting", error: null });
    try {
      const response = await fetch("/api/movement-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          participantLease: session.participantLease,
          granted,
        }),
      });
      if (!response.ok) throw new Error(`Feedback konnte nicht gespeichert werden (${response.status}).`);
      setConsent((current) => current === null ? null : {
        ...current,
        status: granted ? "granted" : "deleted",
        error: null,
      });
    } catch (error) {
      setConsent((current) => current === null ? null : {
        ...current,
        status: "prompt",
        error: error instanceof Error ? error.message : "Feedback konnte nicht gespeichert werden.",
      });
    }
  };

  useEffect(() => {
    if (state.phaseTiming === null || (state.phaseTiming.subtitles.length === 0 && state.phaseTiming.rating?.windows === undefined)) return;
    const update = () => dispatch({ type: "clock-tick", nowMs: Date.now(), ...(connection ? { serverNowMs: connection.clock.now() } : {}) });
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [connection, state.phaseEpoch, state.phaseTiming?.startedAt]);

  const sendPosition = (delivery: "move" | "final" | "start" = "move") => {
    if (!state.inputOpen || state.sessionId === null) return;
    const now = Date.now();
    const shouldSend =
      delivery === "start" ? true : delivery === "final"
        ? throttle.shouldFlushFinal(now)
        : throttle.shouldSend(now);
    if (!shouldSend) return;
    // Curtain-light coordinates are finger samples; only the server knows the cursor position.
    if (!state.curtainLight) realtimeWs.current?.send(position.current.x, position.current.y);
    connection?.send({
      t: "input",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseEpoch: state.phaseEpoch,
      seq: seq.current++,
      ...(delivery === "start" ? { touch: "start" as const } : {}),
      x: position.current.x,
      y: position.current.y,
    });
  };

  // Pointer events can arrive faster than Safari can commit React renders.
  // Keep local feedback on the compositor: retain the latest position and
  // write one transform per display frame without re-rendering the app.
  const scheduleCursorPaint = () => {
    if (cursorPaintFrame.current !== null) return;
    cursorPaintFrame.current = window.requestAnimationFrame(() => {
      cursorPaintFrame.current = null;
      const marker = cursorMarker.current;
      if (marker === null) return;
      marker.style.transform = cursorTransform(position.current, cursorSurfaceSize.current);
    });
  };

  const fingerPosition = (e: React.PointerEvent<HTMLDivElement>): TrackpadState => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    cursorSurfaceSize.current = trackpadSurfaceSize(window.innerWidth, window.innerHeight);
    scheduleCursorPaint();
    lastPointer.current = { x: e.clientX, y: e.clientY };
    if (state.curtainLight) {
      position.current = fingerPosition(e);
      sendPosition("start");
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const last = lastPointer.current;
    if (last === null) return;
    const surface = trackpadSurfaceSize(window.innerWidth, window.innerHeight);
    cursorSurfaceSize.current = surface;
    position.current = state.curtainLight ? fingerPosition(e) : applyDelta(
      position.current,
      e.clientX - last.x,
      e.clientY - last.y,
      surface,
    );
    scheduleCursorPaint();
    lastPointer.current = { x: e.clientX, y: e.clientY };
    sendPosition();
  };

  const onPointerEnd = () => {
    lastPointer.current = null;
    sendPosition("final");
  };

  const sendReaction = (kind: "applause" | "boo") => {
    if (state.sessionId === null) return;
    connection?.send({
      t: "reaction",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseEpoch: state.phaseEpoch,
      kind,
    });
  };

  const selectGroup = (groupId: string) => {
    if (state.sessionId === null) return;
    connection?.send({
      t: "group_selection",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseEpoch: state.phaseEpoch,
      groupId,
    });
  };

  const voteByButton = (outcome: string) => {
    if (state.sessionId === null) return;
    connection?.send({
      t: "button_vote",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseEpoch: state.phaseEpoch,
      outcome,
    });
  };

  return (
    <main
      className="phone-root"
      style={{ touchAction: state.task?.task && state.task.task.status !== "cancelled" ? "pan-y" : "none", userSelect: "none" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {submittedName === null ? (
        <div className="join-screen">
          <form className="join-card" onSubmit={join}>
            <p className="join-eyebrow">Enter the Blackbox</p>
            <h1>Join the session</h1>
            <p>Vote with this phone. Keep this page open and watch the shared screen. Personal show audio requires the native app.</p>
            {state.join.kind === "ended" && <p className="join-message">That show has ended. You can join the next session.</p>}
            <label htmlFor="participant-name">Your name</label>
            <input
              id="participant-name"
              type="text"
              autoComplete="name"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              autoFocus
            />
            <button type="submit" disabled={name.trim() === "" || joinConfig === null}>Join</button>
            {configError && <p className="join-error" role="alert">{configError}</p>}
          </form>
        </div>
      ) : state.join.kind === "rejected" ? (
        <div className="rejected">
          <p>{REJECTION_TEXT[state.join.reason] ?? "Could not join."}</p>
          <button type="button" onClick={tryAgain}>Try again</button>
        </div>
      ) : (
        <div
          className="trackpad"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {state.inputOpen && (state.voting === null || state.voting.method === "phone-cursor") && (
            <p className="trackpad-instruction">Wische um deinen Cursor zu bewegen</p>
          )}
          {state.voting?.method === "physical" && (
            <p className="trackpad-instruction">Antworte mit deiner Position im Raum.</p>
          )}
          {state.voting?.method === "phone-buttons" && (
            <section className="group-selection" aria-label="Antwort wählen">
              <h1>{state.voting.question}</h1>
              <div className="group-selection-options">
                {state.voting.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={state.voting?.closed}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      voteByButton(option.id);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {state.participantState === "finished" && <p className="phone-phase-text" role="status">Deine Gruppe ist fertig. Die anderen Gruppen machen noch weiter.</p>}
          {state.participantState === "unassigned" && !state.groupSelection && <p className="phone-phase-text" role="status">Du bist noch keiner Gruppe zugeteilt. Bitte melde dich beim Team.</p>}
          {state.participantState !== "finished" && state.participantState !== "unassigned" && state.phoneDisplayText !== null && <p className="phone-phase-text" aria-live="polite">{state.phoneDisplayText}</p>}
          {identity && state.inputOpen && !state.curtainLight && <div className="live-cursor-field" aria-hidden="true"><span
              ref={cursorMarker}
              className="live-cursor-dot"
              style={{
                backgroundColor: identity.color,
                transform: cursorTransform(position.current, cursorSurfaceSize.current),
              }}
            /></div>}
          {!state.inputOpen && !state.groupSelection && !state.phoneDisplayText && (
            <p className="watch-screen">{state.voting?.closed ? "Abstimmung beendet" : state.join.kind === "accepted" ? `${submittedName}, watch the screen` : "Joining…"}</p>
          )}
          {state.groupSelection !== null && (
            <section className="group-selection" aria-labelledby="group-selection-title">
              <h1 id="group-selection-title">{state.groupSelection.title ?? "Choose your group"}</h1>
              <div className="group-selection-options">
                {state.groupSelection.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={state.groupSelection?.selectedGroupId === group.id ? "selected" : ""}
                    style={group.color === undefined ? undefined : { "--group-color": group.color } as React.CSSProperties}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); selectGroup(group.id); }}
                    aria-pressed={state.groupSelection?.selectedGroupId === group.id}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {state.ratingCandidateLabel !== null && (
            <div className="rating-buttons" aria-label={`Reactions for ${state.ratingCandidateLabel}`}>
              <button
                type="button"
                className="rating-button applause"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  sendReaction("applause");
                }}
                aria-label={`Applaud ${state.ratingCandidateLabel}`}
              >
                👏
              </button>
              <button
                type="button"
                className="rating-button boo"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  sendReaction("boo");
                }}
                aria-label={`Boo ${state.ratingCandidateLabel}`}
              >
                👎
              </button>
            </div>
          )}
        </div>
      )}

      <ParticipantTaskCard state={state.task} enabled={state.join.kind === "accepted"} clock={connection?.clock}
        respond={(instanceId, optionId) => {
          if (state.join.kind !== "accepted" || !state.sessionId) return;
          connection?.send({ t: "participant_task_response", v: PROTOCOL_VERSION, sessionId: state.sessionId, instanceId, optionId });
        }} />
      <footer className="hud">
        {state.currentGroup && <span className="phone-current-group" aria-label="Deine Gruppe" style={{ color: state.currentGroup.color }}>{state.currentGroup.label}</span>}
        {identity && (
          <span
            className="identity-marker"
            style={{ backgroundColor: identity.color }}
            title={identity.clientId}
          />
        )}
        <span
          className={`connection-dot ${state.join.kind === "accepted" ? "online" : "offline"}`}
        />
      </footer>

      {consent !== null && (
        <div className="consent-backdrop">
          <section
            className="consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="movement-consent-title"
          >
            {consent.status === "granted" ? (
              <p id="movement-consent-title" className="consent-result">Danke für dein Commitment :-)</p>
            ) : consent.status === "deleted" ? (
              <p id="movement-consent-title" className="consent-result">Alles klar. Deine Daten werden gelöscht.</p>
            ) : (
              <>
                <h1 id="movement-consent-title">
                  Möchtest du deine Cursorbewegungen spenden und als Geist in unserer Arena weiterleben?
                </h1>
                <div className="consent-actions">
                  <button type="button" disabled={consent.status === "submitting"} onClick={() => void submitConsent(true)}>
                    JA
                  </button>
                  <button type="button" disabled={consent.status === "submitting"} onClick={() => void submitConsent(false)}>
                    NEIN
                  </button>
                </div>
                {consent.error !== null && <p className="consent-error" role="alert">{consent.error}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
