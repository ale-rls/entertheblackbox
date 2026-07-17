import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import { ServerClock } from "../lib/serverClock.js";
import { LobbyCountdown } from "./LobbyCountdown.js";

const idlePhase = (deadlineAt: number | null): PhaseSnapshotMessage => ({
  kind: "idle",
  id: "idle",
  scenarioVersion: "test",
  startedAt: 0,
  deadlineAt,
});

describe("LobbyCountdown", () => {
  it("renders the server-timed lobby countdown and hides outside the lobby", () => {
    const clock = new ServerClock();
    const lobby = renderToStaticMarkup(
      <LobbyCountdown
        sessionId="lobby"
        phase={idlePhase(Date.now() + 10_000)}
        clock={clock}
      />,
    );
    expect(lobby).toContain('class="countdown countdown-lobby"');
    expect(lobby).toContain(">10<");

    expect(renderToStaticMarkup(
      <LobbyCountdown sessionId="idle" phase={idlePhase(null)} clock={clock} />,
    )).toBe("");
  });
});
