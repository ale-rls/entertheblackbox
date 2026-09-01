import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import { ServerClock } from "../lib/serverClock.js";
import { formatLobbyCountdown, LobbyCountdown } from "./LobbyCountdown.js";

const idlePhase = (deadlineAt: number | null): PhaseSnapshotMessage => ({
  kind: "idle",
  id: "idle",
  scenarioVersion: "test",
  startedAt: 0,
  deadlineAt,
});

describe("LobbyCountdown", () => {
  it("renders the lobby heading, label, instructions, and a minutes/seconds countdown", () => {
    const clock = new ServerClock();
    const lobby = renderToStaticMarkup(
      <LobbyCountdown
        sessionId="lobby"
        phase={idlePhase(Date.now() + 3_661_000)}
        clock={clock}
        joinUrl="https://join.example/phone/"
      />,
    );
    expect(lobby).toContain("61:01");
    expect(lobby).toContain("Join the show");
    expect(lobby).toContain("Show starts in…");
    expect(lobby).toContain("Besucher-WLAN [Netzname]");
    expect(lobby).toContain("https://join.example/phone/");
    expect(lobby).not.toContain("Show starts at");

    expect(renderToStaticMarkup(
      <LobbyCountdown sessionId="idle" phase={idlePhase(null)} clock={clock} joinUrl={null} />,
    )).toBe("");
  });

  it("formats zero-padded durations and floors expired deadlines at zero", () => {
    expect(formatLobbyCountdown(10_000)).toBe("00:10");
    expect(formatLobbyCountdown(3_661_000)).toBe("61:01");
    expect(formatLobbyCountdown(-1)).toBe("00:00");
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
    expect(lobby).not.toContain("lobby-countdown");
  });
});
