# Director decisions (Phase 0)

Authoritative record of the policy decisions the director (Ale) made for the
production installation, plus the Phase 0 deliverables that are still open.
Originally recorded in `steps.md` under STEP-000 (2026-07-12); moved here when
that file was retired as the process record.

These values must be reflected in `content/scenarios/production.json` when it
is authored. Engineering work validates against the fake dev scenario
(`content/scenarios/dev.json`) until then.

## Decided (group a — recorded 2026-07-12)

| Policy | Decision |
| --- | --- |
| Player cap | **30** (matches load-tested capacity) |
| Position-question duration | **60 s** (`durationMs: 60000` per question) |
| Lobby countdown | 10 s (as built, `DEFAULT_PHASE_ENGINE_POLICY`) |
| Interactive-idle timeout | 180 s (as built) |
| Max session duration | 30 min (as built) |
| No-participant grace | 2 min (as built) |
| Resolution freeze | **`freezeMs: 5000`** (changed from the plan's 3 s) |
| Live quadrant counts | **ON** (`showLiveCounts: true` per question) |
| Late join | **LOBBY-ONLY** (`ALLOW_LATE_JOIN=false`; QR hides once a session starts; latecomers wait for the next idle/lobby) — enforced by STEP-035 |
| QR rotation / grant validity / lease | 60 s / 120 s / 2 h (as built) |
| Counted statuses | `["valid", "stale", "disconnected"]` on every quadrant-plurality question (never-moved always excluded) |
| Quadrant boundary convention | center→q4: `x=0.5`→right, `y=0.5`→bottom (shared `quadrantOf`, as implemented) |
| New-question Studio defaults | the four values above (60 s, freeze 5000, live counts on, counted statuses valid+stale+disconnected) — wired in STEP-040 |
| Trackpad sensitivity | deferred to the on-hardware pass (Phase 7 hardware work) |

## Still open (blockers for launch)

- **(b) Content production** — axis wording + quadrant naming per question, the
  full content graph, quadrant/tie/empty targets (including the abandoned-solo
  empty-target review), media inventory with durations and the 2 GiB
  arithmetic, opening hours/timezone + reset grace. Lands as
  `content/scenarios/production.json` (hand-authored JSON or exported from Show
  Studio).
- **(c) Hardware procurement** — the venue-spec mini PC.
- **(d) Privacy package** — visitor notice, privacy policy, processor/log-
  retention review, deletion schedule.
