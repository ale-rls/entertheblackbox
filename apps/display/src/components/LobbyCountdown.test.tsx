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
  it("renders the start time and URL but hides a distant countdown", () => {
    const clock = new ServerClock();
    const lobby = renderToStaticMarkup(
      <LobbyCountdown
        sessionId="lobby"
        phase={idlePhase(Date.now() + 60_000)}
        clock={clock}
        joinUrl="https://join.example/phone/"
      />,
    );
    expect(lobby).toContain("Show starts at");
    expect(lobby).toContain("https://join.example/phone/");
    expect(lobby).not.toContain("lobby-final-countdown");

    expect(renderToStaticMarkup(
      <LobbyCountdown sessionId="idle" phase={idlePhase(null)} clock={clock} joinUrl={null} />,
    )).toBe("");
  });

  it("shows only the final ten seconds at the top", () => {
    const clock = new ServerClock();
    const lobby = renderToStaticMarkup(
      <LobbyCountdown
        sessionId="lobby"
        phase={idlePhase(Date.now() + 10_000)}
        clock={clock}
        joinUrl={null}
      />,
    );
    expect(lobby).toContain('class="lobby-final-countdown"');
    expect(lobby).toContain(">10<");
    expect(lobby).toContain("seconds");
  });

  it("keeps the join URL visible in a manual lobby without a deadline", () => {
    const lobby = renderToStaticMarkup(
      <LobbyCountdown
        sessionId="lobby"
        phase={idlePhase(null)}
        clock={new ServerClock()}
        joinUrl="https://join.example/phone/"
      />,
    );
    expect(lobby).toContain("https://join.example/phone/");
    expect(lobby).not.toContain("Show starts at");
  });
});
