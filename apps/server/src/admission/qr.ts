import { PROTOCOL_VERSION, type QrGrantMessage, type QrHiddenMessage } from "@entertheblackbox/protocol";
import type { JoinGrantClaims } from "./tokens.js";

export type QrLifecycle = "idle" | "lobby" | "active";
export type QrPushMessage = QrGrantMessage | QrHiddenMessage;

export function phoneJoinUrl(phoneJoinBaseUrl: string, rehearsalId?: string): string {
  const url = new URL(phoneJoinBaseUrl);
  url.search = "";
  if (rehearsalId) url.searchParams.set("rehearsal", rehearsalId);
  url.hash = "";
  return url.toString();
}

export type QrGrantPushLoopOptions = {
  phoneJoinBaseUrl: string;
  rehearsalId?: string;
  issueGrant: (now: number) => {
    token: string;
    claims: Pick<JoinGrantClaims, "installationId" | "roomId" | "expiresAt">;
  };
  /** The main display (the projection). */
  send: (message: QrPushMessage) => void;
  /** Signage kiosks (e.g. the entrance screen): they keep the join QR while late joining is allowed. */
  sendSignage?: (message: QrPushMessage) => void;
  lifecycle: () => QrLifecycle;
  hasDisplay: () => boolean;
  now?: () => number;
  rotationMs?: number;
  allowLateJoin?: boolean;
  activeQrVisibility?: "corner" | "hidden";
  showPhoneJoinBaseUrl?: boolean;
};

export class QrGrantPushLoop {
  private readonly now: () => number;
  private readonly rotationMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: QrGrantPushLoopOptions) {
    this.now = options.now ?? (() => Date.now());
    this.rotationMs = options.rotationMs ?? 60_000;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.options.hasDisplay()) this.push();
    }, this.rotationMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  push(): void {
    const lifecycle = this.options.lifecycle();
    // Admission and presentation are separate policies: returning/new late
    // participants may still be accepted, but the installation must never
    // advertise a join code over the active show. A signage kiosk is not over
    // the show: it keeps the code for as long as late arrivals can still join.
    if (lifecycle === "active") {
      const hidden: QrPushMessage = { t: "qr_hidden", v: PROTOCOL_VERSION };
      this.options.send(hidden);
      this.options.sendSignage?.(this.options.allowLateJoin ? this.grant() : hidden);
      return;
    }

    const message = this.grant();
    this.options.send(message);
    this.options.sendSignage?.(message);
  }

  private grant(): QrPushMessage {
    const now = this.now();
    const grant = this.options.issueGrant(now);
    return {
      t: "qr_grant",
      v: PROTOCOL_VERSION,
      url: phoneJoinUrl(this.options.phoneJoinBaseUrl, this.options.rehearsalId),
      expiresAt: grant.claims.expiresAt,
      placement: "large",
      showJoinUrl: this.options.showPhoneJoinBaseUrl !== false,
    };
  }
}
