import type { WebSocket } from "ws";
import { encodeMessage, PROTOCOL_VERSION, type WallMessage, type WallStatusMessage } from "@entertheblackbox/protocol";
import { DEFAULT_WALL_LAYOUT, parseWallSliceFileName, wallMountRotation, wallSlotForLabel, wallSlotIds, type WallLayout } from "@entertheblackbox/shared";

/** Lead between pressing Play and the shared start: covers LAN fan-out and the tablets' decoder start. */
export const WALL_PLAY_LEAD_MS = 1_500;

export type WallSliceFile = { src: string; bytes: number; sha256: string };
/**
 * sliced: pre-cut `<clip>__<slot>.mp4` files, one per position.
 * whole: one uncut video; every tablet downloads it and crops its own region.
 */
export type WallClip =
  | { id: string; kind: "sliced"; slices: Record<string, WallSliceFile> }
  | { id: string; kind: "whole"; file: WallSliceFile };
type Recipient = { clientId: string; name?: string; connected?: boolean; socket?: WebSocket | undefined };
export type WallDeviceStatus = Omit<WallStatusMessage, "t" | "v"> & { at: number };

/**
 * Wall clips from the media library: files named `<clip>__<slot>.mp4` group
 * into pre-cut clips; every other MP4 can play uncut, cropped on the tablets.
 */
export function wallClipsFromMedia(records: readonly { src: string; bytes: number; hash?: string }[]): WallClip[] {
  const sliced = new Map<string, Extract<WallClip, { kind: "sliced" }>>();
  const whole: WallClip[] = [];
  for (const record of records) {
    if (!record.hash || !/^[a-f0-9]{64}$/.test(record.hash) || !(record.bytes > 0)) continue;
    const file = { src: record.src, bytes: record.bytes, sha256: record.hash };
    const parsed = parseWallSliceFileName(record.src);
    if (parsed) {
      const clip = sliced.get(parsed.clip) ?? { id: parsed.clip, kind: "sliced" as const, slices: {} };
      clip.slices[parsed.slot] = file;
      sliced.set(parsed.clip, clip);
    } else if (/\.mp4$/i.test(record.src) && !/[\\/]/.test(record.src) && record.src.length <= 100) {
      whole.push({ id: record.src, kind: "whole", file });
    }
  }
  return [...sliced.values(), ...whole].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Drives the tablet video wall. Each device gets its own `wall` message (its
 * slot's slice) carrying the full desired state, so reconnecting or late
 * devices converge by receiving the latest message. Playback position is
 * derived on the device from `startAt` on the shared server clock.
 */
export class VideoWallController {
  private seq = 0;
  private layoutValue: WallLayout = DEFAULT_WALL_LAYOUT;
  private clip: WallClip | null = null;
  private startAt: number | null = null;
  private loop = true;
  private statuses = new Map<string, WallDeviceStatus>();

  constructor(private readonly options: {
    recipients: () => Iterable<Recipient>;
    clips: () => Promise<WallClip[]>;
    /** Make sure the slice files are present in the served media directory. */
    ensureLocal?: (src: string) => Promise<void>;
    now?: () => number;
  }) {}

  get layout(): WallLayout { return this.layoutValue; }

  /** Restore the persisted layout at startup without broadcasting. */
  restoreLayout(layout: WallLayout): void { this.layoutValue = layout; }

  /** Layout or slot assignment changed: tablets may now have a different slice. */
  setLayout(layout: WallLayout): number {
    this.layoutValue = layout;
    return this.broadcast();
  }

  async load(clipId: string): Promise<{ ok: true; delivered: number } | { ok: false; error: string }> {
    const clip = (await this.options.clips()).find((candidate) => candidate.id === clipId);
    if (!clip) return { ok: false, error: "unknown_clip" };
    if (clip.kind === "whole") await this.options.ensureLocal?.(clip.file.src);
    else {
      const slots = new Set(wallSlotIds(this.layoutValue));
      for (const [slot, file] of Object.entries(clip.slices)) if (slots.has(slot)) await this.options.ensureLocal?.(file.src);
    }
    this.clip = clip;
    this.startAt = null;
    this.statuses.clear();
    return { ok: true, delivered: this.broadcast() };
  }

  /** Start (or restart from the top) on the shared clock after a short lead. */
  play(leadMs = WALL_PLAY_LEAD_MS): { ok: true; delivered: number; startAt: number } | { ok: false; error: string } {
    if (!this.clip) return { ok: false, error: "no_clip_loaded" };
    this.startAt = this.now() + leadMs;
    return { ok: true, delivered: this.broadcast(), startAt: this.startAt };
  }

  /** Back to paused on the first frame, clip kept loaded. */
  cue(): number {
    this.startAt = null;
    return this.broadcast();
  }

  /** Clear the wall: tablets go back to their surface colour. */
  stop(): number {
    this.clip = null;
    this.startAt = null;
    return this.broadcast();
  }

  setLoop(loop: boolean): number {
    this.loop = loop;
    return this.broadcast();
  }

  /** Initial state for a device that just joined (or rejoined). */
  welcome(socket: WebSocket, name: string | undefined): void {
    send(socket, this.messageFor(name));
  }

  report(clientId: string, status: WallStatusMessage): void {
    const { t: _t, v: _v, ...rest } = status;
    this.statuses.set(clientId, { ...rest, at: this.now() });
  }

  snapshot() {
    const devices = [...this.options.recipients()].map((recipient) => {
      const slot = recipient.name ? wallSlotForLabel(this.layoutValue, recipient.name) : null;
      const status = this.statuses.get(recipient.clientId);
      return { clientId: recipient.clientId, name: recipient.name ?? "", slot, connected: recipient.connected ?? isOpen(recipient.socket),
        ...(status ? { status } : {}) };
    });
    return {
      layout: this.layoutValue,
      state: { clip: this.clip?.id ?? null, startAt: this.startAt, loop: this.loop },
      devices,
      serverNow: this.now(),
    };
  }

  private messageFor(name: string | undefined): WallMessage {
    const slot = name ? wallSlotForLabel(this.layoutValue, name) : null;
    const clip = this.clip;
    const file = !slot || !clip ? undefined : clip.kind === "whole" ? clip.file : clip.slices[slot];
    const layout = this.layoutValue;
    const region = clip?.kind === "whole" ? {
      cols: layout.cols, rows: layout.rows, screenWidthMm: layout.screen.widthMm, screenHeightMm: layout.screen.heightMm,
      gapXMm: layout.gapMm.x, gapYMm: layout.gapMm.y, fit: layout.fit,
      sourceWidthPx: layout.source.widthPx, sourceHeightPx: layout.source.heightPx,
    } : undefined;
    return {
      t: "wall", v: PROTOCOL_VERSION, seq: ++this.seq,
      clip: slot && file && clip ? { id: clip.id, slot, url: `/media/${encodeURIComponent(file.src)}`, bytes: file.bytes, sha256: file.sha256,
        ...(wallMountRotation(layout.mount) ? { rotation: wallMountRotation(layout.mount) } : {}), ...(region ? { region } : {}) } : null,
      startAt: this.startAt,
      loop: this.loop,
    };
  }

  private broadcast(): number {
    let delivered = 0;
    for (const recipient of this.options.recipients()) {
      if (!recipient.socket || !isOpen(recipient.socket)) continue;
      send(recipient.socket, this.messageFor(recipient.name));
      delivered += 1;
    }
    return delivered;
  }

  private now() { return (this.options.now ?? Date.now)(); }
}

const isOpen = (socket: WebSocket | undefined) => socket !== undefined && (socket.readyState === undefined || socket.readyState === 1);
const send = (socket: WebSocket, message: WallMessage) => { if (isOpen(socket)) socket.send(encodeMessage(message)); };
