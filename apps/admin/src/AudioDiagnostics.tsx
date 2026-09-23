import { useEffect, useState } from "react";
import type { Status } from "./App";

type Player = NonNullable<Status["audio"]>["players"][number];
const labels: Record<string, string> = { ready: "Ready to start", connecting: "Connecting", playing: "Playing", reconnecting: "Recovering", paused: "Paused", blocked: "Needs a tap" };
function needsAttention(player: Player): boolean {
  return !player.connected || player.flagged || player.playbackState === "reconnecting" || player.playbackState === "blocked";
}
function age(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Read-only operator view. Connection counts are not an audibility signal. */
export function AudioDiagnostics({ status, receivedAt, failed }: { status: Status; receivedAt: number | null; failed: boolean }) {
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = receivedAt == null ? 0 : Math.max(0, now - receivedAt);
  const stale = failed || receivedAt == null || elapsed > 10_000;
  const audio = status.audio;
  const players = audio?.players ?? [];
  const rosterUnavailable = !!audio?.error && players.length === 0;
  const bridgeAge = audio?.poll_age_s == null ? null : audio.poll_age_s * 1000 + elapsed;
  const bridgeStale = bridgeAge == null || bridgeAge > 15_000;
  const uncertain = stale || bridgeStale || !!audio?.error;
  const visible = players.filter(p => (!attentionOnly || needsAttention(p) || !!audio?.deliveryFailures?.[p.player_id])
    && `${p.name ?? ""} ${p.player_id}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || (a.name ?? a.player_id).localeCompare(b.name ?? b.player_id));
  const interruptions = players.reduce((sum, p) => sum + (p.reconnects ?? 0), 0);
  const reported = players.filter(p => p.reconnects !== undefined).length;
  return <div className="audio-diagnostics">
    <section className="sc-tool-panel" aria-label="Audio overview">
      <div className="admin-section-heading">
        <div><p className="sc-tool-eyebrow">Live audio / read only</p><h2>Connection overview</h2></div>
        <span className="sc-tool-status" data-sc-tool-status={stale ? "warning" : "success"}>{stale ? "Updates stale" : "Receiving updates"}</span>
      </div>
      <p>Last dashboard update: {receivedAt == null ? "not received" : `${age(elapsed)} ago`}. Refreshes every 2 seconds.</p>
      {!audio?.configured ? <p role="status">Audio bridge is not configured.</p> : <>
        <p>Backend: <strong>{audio.backendLabel ?? audio.backend ?? "Unknown"}</strong> · Listener poll: {bridgeAge == null ? "unavailable" : `${age(bridgeAge)} ago`}</p>
        {uncertain && <p role="alert">Connection data is stale or unavailable. Values below are the last reported snapshot.</p>}
        {audio.error && <p role="alert">Audio backend: {audio.error}</p>}
        <dl className="audio-summary">
          <div><dt>Registered phones</dt><dd>{rosterUnavailable ? "—" : players.length}</dd></div>
          <div><dt>With stream connections</dt><dd>{rosterUnavailable ? "—" : players.filter(p => p.connected).length}<small>{uncertain ? "Last reported" : "Listener snapshot"}</small></dd></div>
          <div><dt>Reported recovering</dt><dd>{rosterUnavailable ? "—" : players.filter(p => p.playbackState === "reconnecting").length}<small>Last phone reports</small></dd></div>
          <div><dt>Reported interruptions</dt><dd>{reported ? interruptions : "—"}<small>{reported} of {players.length} phones reporting</small></dd></div>
        </dl>
        {audio.capacity && <p>Bridge capacity: {audio.capacity.assigned} / {audio.capacity.total} slots assigned · {audio.capacity.available} available.</p>}
      </>}
    </section>
    <section className="sc-tool-panel" aria-labelledby="audio-listeners-heading">
      <div className="admin-section-heading"><h2 id="audio-listeners-heading">Per-phone connectivity</h2><span>{visible.length} / {players.length}</span></div>
      <div className="audio-filters">
        <label className="sc-tool-label">Find a phone<input className="sc-tool-field" type="search" placeholder="Name or player ID" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label><input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} /> Needs attention only</label>
      </div>
      <div className="audio-table-scroll" tabIndex={0} role="region" aria-label="Phone connectivity table">
        <table className="audio-table">
          <thead><tr><th scope="col">Phone</th><th scope="col">Audio connections</th><th scope="col">Show connection</th><th scope="col">Last phone report</th><th scope="col">Interruptions</th><th scope="col">Last recovery</th><th scope="col">Report received</th></tr></thead>
          <tbody>{visible.map(p => {
            const participant = status.participants.find(participant => participant.clientId === p.player_id);
            return <tr key={p.player_id}>
              <th scope="row">{p.name ?? p.player_id}<small>{p.name ? p.player_id : ""}{p.transport ? ` · ${p.transport === "janus" ? "Janus" : "Icecast"}` : ""}</small>{audio?.deliveryFailures?.[p.player_id] && <small role="alert">Delivery failed: {audio.deliveryFailures[p.player_id]}</small>}</th>
              <td><span className="sc-tool-status" data-sc-tool-status={uncertain || !p.connected ? "warning" : "success"}>{uncertain ? "Last reported: " : ""}{p.connected ? `${p.listeners} connected` : p.flagged ? "Missing listener" : "Waiting for listener"}</span></td>
              <td>{participant ? participant.connected ? "Connected" : "Disconnected" : "Unknown"}</td>
              <td>{labels[p.playbackState ?? ""] ?? p.playbackState ?? "No report"}</td>
              <td>{p.reconnects ?? "—"}</td>
              <td>{p.lastRecoveryMs == null ? "—" : `${(p.lastRecoveryMs / 1000).toFixed(1)}s`}</td>
              <td>{p.phoneReportAgeMs == null ? "Unknown" : `${age(p.phoneReportAgeMs + elapsed)} ago`}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!visible.length && <p>{players.length ? "No phones match these filters." : audio?.error ? "Phone roster unavailable while the audio backend is unreachable." : "No registered audio phones yet."}</p>}
    </section>
    <section className="sc-tool-panel" aria-label="How to read these statistics">
      <h2>What these numbers tell you</h2>
      <p>Audio connections come from the streaming server, polled about every 5 seconds. The show connection is separate: a backgrounded phone can lose its show connection while audio continues.</p>
      <p>Phone reports are sent on playback state changes, not as heartbeats. An old report alone does not mean audio stopped. Reports can be delayed while a phone is locked.</p>
      <p>Interruptions count entries into recovery, including buffering; they are not a count of confirmed disconnections. Recovery time is phone-reported time until playback resumes. Counts reset when server telemetry is cleared, including on a server restart.</p>
      <p>These statistics do not measure audible output or cue-to-ear latency.</p>
    </section>
  </div>;
}
