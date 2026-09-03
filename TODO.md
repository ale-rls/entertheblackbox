# TODO

## Loading

- [ ] Remove the "Exit fullscreen" control while already in fullscreen (or otherwise fix its behavior) — `apps/display/src/components/FullscreenControl.tsx` (toggle logic L27-42, label L44-56), used in `apps/display/src/App.tsx:266`.
- [ ] Swap the top and bottom text in the waiting room — heading vs. instructions in `apps/display/src/components/LobbyCountdown.tsx` (`.lobby-heading` L53, `.lobby-instructions` L60-63).
- [ ] Remove the "other looking" attract video from the waiting room — `apps/display/src/components/IdleAttract.tsx` (video element L153-164), rendered from `apps/display/src/App.tsx:222-229`; source clips in `apps/display/src/assets/*.mp4`.

## Voting

- [ ] Make the horizontal two-quadrant vote (Ostrakismós) support both "split" and "spectrum" as selectable variants, not spectrum-only. Current spectrum rendering: `apps/display/src/components/QuadrantOverlay.tsx:281-283,353-355,501-504`, CSS `apps/display/src/style.css:143`. Prior "split" version (hard divider, no origin circle) is recoverable from git history at commit `e43569c` (`git show e43569c:apps/display/src/components/QuadrantOverlay.tsx` / `style.css`) — introduced as spectrum-only in `2d3037c`.
- [ ] Add a `variant: "split" | "spectrum"` field to `twoQuadrantFieldSchema` (`packages/scenario/src/schema.ts:93-98`), mirror it in `packages/protocol/src/messages.ts`, branch the render in `QuadrantOverlay.tsx`, and expose the choice in the studio's "Position layout" select (`apps/studio/src/inspector/Inspector.tsx:137`).
- [ ] (Context, no action needed) Kleroterion tie-break and the third mechanism (`polygon-zones` / `quadrant-plurality` statue election) are already implemented — `packages/scenario/src/schema.ts:106-114,127-130,169-189`, `apps/server/src/votes/vote-engine.ts:74,125-132`.
- [ ] edit the latest draft in the production studio to use this hard split instead of the spectrum for the questions early in the scene: ostrakismos, kleroterion and prometheus

## Questions

- [ ] people should be able to decide longer on the questions on the 2.6 section. Please edit the latest draft to give people 10 seconds to position themselves before the voting closes
- [ ] Improve positioning of the circle (the phone's live cursor marker) — `apps/phone/src/App.tsx:253-257` (`live-cursor-dot`), driven by `apps/phone/src/lib/trackpad.ts` (`applyDelta`, `TRACKPAD_CENTER`). Investigate accuracy/centering/sensitivity.

## Clapping

- [ ] Fix: the clap/boo buttons on the phone are shown for the entire video phase instead of only during the configured reaction windows. Root cause — `apps/phone/src/state/store.ts:95-98` sets `ratingCandidateLabel` whenever `phase.rating` exists, without checking `phase.rating.windows` against elapsed time. Buttons render in `apps/phone/src/App.tsx:261-288` gated only on `ratingCandidateLabel !== null`. Fix by porting the `insideWindow` check already used correctly for sound in `apps/display/src/components/CrowdReactionSounds.tsx:72-73` into the phone's state/reducer (`PhoneState` in `store.ts:20-31` has no elapsed-time/window tracking yet — needs adding).

## Phone display

- [ ] Always show the title of the current scene on the phone (currently display-only: `apps/display/src/App.tsx:307-308`, `.video-title`). Add equivalent rendering to `apps/phone/src/App.tsx`.
- [ ] Show subtitles on the phone when active (currently display-only via `apps/display/src/components/PhaseSubtitles.tsx`, used at `apps/display/src/App.tsx:310`). Add equivalent rendering to `apps/phone/src/App.tsx`.
! you can use the same field for these two. If they are both present in the timeline, prefer subtitle
- [ ] Don't map the phone's X/Y cursor to the full trackpad area — show the original/raw normalized point instead of stretching it to 100% of the surface. Current mapping: `apps/phone/src/App.tsx:256` (`left: ${visiblePosition.x * 100}%, top: ${visiblePosition.y * 100}%`), values sourced from `apps/phone/src/lib/trackpad.ts` (`applyDelta`, 0..1 normalized via `clamp01`).
