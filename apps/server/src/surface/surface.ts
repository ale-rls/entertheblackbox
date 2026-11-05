import type { WebSocket } from "ws";
import { encodeMessage, PROTOCOL_VERSION, type SurfaceMessage } from "@entertheblackbox/protocol";

/** Default scheduling lead: absorbs LAN fan-out so every tablet switches on the same frame. */
export const SURFACE_LEAD_MS = 60;
export const SURFACE_TAP_HOLD_MS = 250;
export const SURFACE_IDENTIFY_HOLD_MS = 3_000;

type Recipient = { clientId: string; name?: string; socket?: WebSocket | undefined };
export type SurfaceTarget = "all" | readonly string[];
export type SurfacePlay =
  | { mode: "flash"; color: string; holdMs?: number }
  | { mode: "release" }
  | { mode: "identify" };

/**
 * Pushes native show-mode surface colour over the participant WebSockets.
 * Delivery goes through the admission registry, so it works with or without
 * a running show and reaches phones inside group-branch paths.
 */
export class SurfaceController {
  private seq = 0;
  private base: string;

  constructor(private readonly options: {
    recipients: () => Iterable<Recipient>;
    now?: () => number;
    leadMs?: number;
    initialColor?: string;
  }) {
    this.base = options.initialColor ?? "#000000";
  }

  get baseColor(): string { return this.base; }

  /** Restore the persisted base colour at startup without broadcasting. */
  restoreBase(color: string): void { this.base = color; }

  /** Change every device's resting colour (Admin display settings). */
  setBase(color: string): number {
    this.base = color;
    return this.deliver("all", () => ({ mode: "set", color }));
  }

  /** Initial state for a socket that just joined: applied immediately. */
  welcome(socket: WebSocket): void {
    send(socket, this.message({ mode: "set", color: this.base }, 0));
  }

  play(target: SurfaceTarget, play: SurfacePlay): number {
    if (play.mode === "release") return this.deliver(target, () => ({ mode: "release", color: this.base }));
    if (play.mode === "identify") {
      return this.deliver(target, (recipient) => ({ mode: "flash", color: "#ffffff", holdMs: SURFACE_IDENTIFY_HOLD_MS,
        ...(recipient.name ? { label: recipient.name.slice(0, 40) } : {}) }));
    }
    return this.deliver(target, () => ({ mode: "flash", color: play.color, ...(play.holdMs === undefined ? {} : { holdMs: play.holdMs }) }));
  }

  private deliver(target: SurfaceTarget, build: (recipient: Recipient) => Pick<SurfaceMessage, "mode" | "color" | "holdMs" | "label">): number {
    const wanted = target === "all" ? null : new Set(target);
    // One applyAt per gesture keeps every addressed device in lockstep.
    const applyAt = (this.options.now ?? Date.now)() + (this.options.leadMs ?? SURFACE_LEAD_MS);
    let delivered = 0;
    for (const recipient of this.options.recipients()) {
      if (wanted && !wanted.has(recipient.clientId)) continue;
      if (!recipient.socket || !isOpen(recipient.socket)) continue;
      send(recipient.socket, this.message(build(recipient), undefined, applyAt));
      delivered += 1;
    }
    return delivered;
  }

  private message(body: Pick<SurfaceMessage, "mode" | "color" | "holdMs" | "label">, leadMs?: number, applyAt?: number): SurfaceMessage {
    return { t: "surface", v: PROTOCOL_VERSION, ...body, seq: ++this.seq,
      applyAt: applyAt ?? (this.options.now ?? Date.now)() + (leadMs ?? this.options.leadMs ?? SURFACE_LEAD_MS) };
  }
}

const isOpen = (socket: WebSocket) => socket.readyState === undefined || socket.readyState === 1;
const send = (socket: WebSocket, message: SurfaceMessage) => { if (isOpen(socket)) socket.send(encodeMessage(message)); };
