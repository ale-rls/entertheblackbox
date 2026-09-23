export type VideoPhaseIdentity = {
  sessionId: string;
  phaseId: string;
  phaseEpoch: number;
};

type ActiveVideo = VideoPhaseIdentity & { endAt: number };

/**
 * Owns the one-shot completion gate for the current video phase. The server
 * clock ends a video at its expected duration; displays only play along.
 */
export class VideoPhaseHandler {
  private active: ActiveVideo | null = null;

  begin(identity: VideoPhaseIdentity, expectedDurationMs: number, now: number): number {
    const endAt = now + expectedDurationMs;
    this.active = { ...identity, endAt };
    return endAt;
  }

  cancel(): void {
    this.active = null;
  }

  consumeEnded(now: number): VideoPhaseIdentity | null {
    if (this.active === null || now < this.active.endAt) return null;
    const { sessionId, phaseId, phaseEpoch } = this.active;
    this.active = null;
    return { sessionId, phaseId, phaseEpoch };
  }
}
