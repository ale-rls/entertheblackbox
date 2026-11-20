import type { TimingMonitor } from "@entertheblackbox/protocol";
import type { Status } from "./App.js";

export const REPORT_MAX_AGE_MS = 6000;
export const clockText = (ms: number) => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
type Participant = Status["participants"][number];
export type MonitorGroup = {
  id: string; label: string; participants: Participant[]; phaseId: string | null;
  phaseEpoch: number | null; startedAt: number | undefined; deadlineAt: number | null | undefined;
  state: "active" | "choosing" | "finished" | "empty" | "unassigned";
};

/** Leaf path rosters are authoritative, including transfers, nested splits and late joins. */
export function monitorGroups(status: Status): MonitorGroup[] {
  const paths = status.groupPathsStarted ? status.groupPaths.filter(p => p.state !== "split") : [];
  const pathByMember = new Map(paths.flatMap(p => p.memberIds.map(id => [id, p.groupId] as const)));
  const groups = [...(status.groups ?? [])];
  for (const path of paths) if (!groups.some(g => g.id === path.groupId)) groups.push({ id: path.groupId, label: path.label });
  const rows: MonitorGroup[] = groups.flatMap(group => {
    const path = paths.find(p => p.groupId === group.id);
    if (status.groupPathsStarted && !path && status.groupPaths.some(p => p.groupId === group.id && p.state === "split")) return [];
    const participants = status.participants.filter(p => status.groupPathsStarted ? pathByMember.get(p.clientId) === group.id : p.groupId === group.id);
    return [{ id: group.id, label: group.label, participants,
      phaseId: path?.phaseId ?? (status.groupPathsStarted ? null : status.phaseId),
      phaseEpoch: path?.phaseEpoch ?? (status.groupPathsStarted ? null : status.phaseEpoch),
      startedAt: path?.startedAt ?? (status.groupPathsStarted ? undefined : status.phaseTiming?.startedAt),
      deadlineAt: path ? path.deadlineAt : status.groupPathsStarted ? null : status.phaseTiming?.deadlineAt,
      state: !participants.length ? "empty" : path?.done || path?.state === "finished" ? "finished" : path?.state === "choosing" ? "choosing" : "active" }];
  });
  const assigned = new Set(rows.flatMap(r => r.participants.map(p => p.clientId)));
  const waiting = status.participants.filter(p => !assigned.has(p.clientId));
  if (waiting.length || !rows.length) rows.push({ id: "__shared", label: status.groupPathsStarted ? "Unassigned" : groups.length ? "No group" : "Shared",
    participants: waiting, phaseId: status.groupPathsStarted ? null : status.phaseId, phaseEpoch: status.groupPathsStarted ? null : status.phaseEpoch,
    startedAt: status.groupPathsStarted ? undefined : status.phaseTiming?.startedAt, deadlineAt: status.groupPathsStarted ? null : status.phaseTiming?.deadlineAt,
    state: status.groupPathsStarted ? "unassigned" : waiting.length ? "active" : "empty" });
  return rows;
}

export type DeviceAudio = { label: string; attention: boolean; remainingMs: number | null; positionMs: number | null;
  durationMs: number | null; reportAgeMs: number | null; driftMs: number | null; src: string | null; music: string | null };
export function deviceAudio(participant: Participant, group: MonitorGroup, report: TimingMonitor | undefined,
  elapsed: number, stale: boolean, now: number | null): DeviceAudio {
  const age = report?.reportAgeMs == null ? null : report.reportAgeMs + elapsed;
  const result: DeviceAudio = { label: "Unknown", attention: true, remainingMs: null, positionMs: null, durationMs: null,
    reportAgeMs: age, driftMs: null, src: null, music: null };
  if (stale) return { ...result, label: "Stale" };
  if (!participant.connected || report?.connected === false) return { ...result, label: "Offline" };
  if (!report?.timing || age === null) return result;
  if (age > REPORT_MAX_AGE_MS) return { ...result, label: "Stale" };
  if (report.phaseId !== group.phaseId || report.phaseEpoch !== group.phaseEpoch) return { ...result, label: "Other cue" };
  const media = report.timing.media.find(m => m.role === "main");
  const music = report.timing.media.find(m => m.role === "extra");
  result.music = music ? `Music ${music.state}` : null;
  if (!media) {
    if (report.mediaExpected) return { ...result, label: "Awaiting audio" };
    if (music && music.state !== "ended") return { ...result, label: music.state === "playing" ? "Music only" : `Music ${music.state}`, attention: music.state !== "playing" };
    return { ...result, label: "Silent", attention: false };
  }
  result.src = media.src ?? null;
  result.durationMs = media.durationMs ?? null;
  result.positionMs = media.positionMs;
  result.driftMs = media.driftMs;
  if (media.state === "ended") return { ...result, label: "Ended", attention: false, remainingMs: 0 };
  if (media.state !== "playing") return { ...result, label: media.state.charAt(0).toUpperCase() + media.state.slice(1) };
  const clockFresh = report.timing.calibrated && report.timing.sampleAgeMs !== null && report.timing.sampleAgeMs + age <= 30000;
  const measured = report.timing.mode === "synchronized" && clockFresh;
  if (measured && now !== null && media.positionMs !== null && media.durationMs != null) {
    result.remainingMs = Math.max(0, media.durationMs - media.positionMs - age);
    if (now !== null && media.endsAt != null) result.remainingMs = Math.min(result.remainingMs, Math.max(0, media.endsAt - now));
  }
  const drifted = measured && media.driftMs !== null && Math.abs(media.driftMs) > 250;
  return { ...result, label: drifted ? "Out of sync" : "Playing", attention: drifted || !clockFresh };
}

export function audioSummary(devices: DeviceAudio[]): string {
  const counts = new Map<string, number>();
  for (const d of devices) counts.set(d.label.toLowerCase(), (counts.get(d.label.toLowerCase()) ?? 0) + 1);
  return [...counts].map(([label, count]) => `${count} ${label}`).join(" · ") || "—";
}
export function audioRemaining(devices: DeviceAudio[]): string {
  if (!devices.length || devices.every(d => d.label === "Silent" || d.label === "Music only")) return "—";
  if (devices.every(d => d.label === "Ended" || d.label === "Silent" || d.label === "Music only")) return "Done";
  const values = devices.flatMap(d => d.remainingMs === null || d.label === "Ended" ? [] : [d.remainingMs]);
  if (!values.length) return "Unknown";
  const min = clockText(Math.min(...values)), max = clockText(Math.max(...values));
  return `~${min === max ? max : `${min}–${max}`}`;
}
