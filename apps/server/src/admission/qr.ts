import { PROTOCOL_VERSION, type QrGrantMessage, type QrHiddenMessage } from "@smartphonecracy/protocol";
import type { JoinGrantClaims } from "./tokens.js";

export type QrLifecycle = "idle" | "lobby" | "active";
export type QrPushMessage = QrGrantMessage | QrHiddenMessage;

export type QrGrantPushLoopOptions = {
  phoneJoinBaseUrl: string;
  issueGrant: (now: number) => {
    token: string;
    claims: Pick<JoinGrantClaims, "installationId" | "roomId" | "expiresAt">;
  };
  send: (message: QrPushMessage) => void;
  lifecycle: () => QrLifecycle;
  hasDisplay: () => boolean;
  now?: () => number;
  rotationMs?: number;
  allowLateJoin?: boolean;
  activeQrVisibility?: "corner" | "hidden";
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
    if (
      lifecycle === "active" &&
      (this.options.allowLateJoin === false || this.options.activeQrVisibility === "hidden")
    ) {
      this.options.send({ t: "qr_hidden", v: PROTOCOL_VERSION });
      return;
    }

    const now = this.now();
    const grant = this.options.issueGrant(now);
    const url = new URL(this.options.phoneJoinBaseUrl);
    url.search = "";
    url.hash = "";
    this.options.send({
      t: "qr_grant",
      v: PROTOCOL_VERSION,
      url: url.toString(),
      expiresAt: grant.claims.expiresAt,
      placement: lifecycle === "active" ? "corner" : "large",
    });
  }
}
