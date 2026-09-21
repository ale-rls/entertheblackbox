# Group branching and targeted audio

Runtime schema version 5 makes audience groups first-class show state. Studio authors can define a stable group catalogue, start a session with multiple balanced groups, add a **Group branch** component, and attach either broadcast or group-specific phone narration to later phases.

## Authoring in Studio

Use **Groups** in the Studio toolbar (or click empty canvas) to edit the labelled group catalogue and initial groups. A show can begin with two or more initial groups; the server balances admitted participants across them when the session starts. In any existing group scene, use **Group options** to add catalogue groups or remove options, with a minimum of two. Removing a catalogue group updates its references, but is blocked if a scene would be left with fewer than two options.

Add a **Group branch** component at the moment membership should change. Its inputs are an optional source cohort and one assignment rule. Its outputs are two or more group memberships:

- **Balanced** distributes the source cohort according to output weights.
- **From vote** maps each participant's result from an earlier position question to a group, with a required fallback.
- **Manual** keeps a participant's operator-assigned output group and sends anyone else to the fallback.

**Chosen by participants on their phones** presents the scene's labelled group options until its duration expires. A selection can be changed before the deadline, not after paths start. Reconnecting does not assign an unchosen phone automatically.

Each group has a separate outgoing port. Connect it to that group's first scene (`branches[].next`), then connect **Rejoin (all groups)** to the shared reunion scene (`next`). Groups run their own media, voting, results and phone audio independently. A group arriving at the reunion (or End) waits silently; the shared scene begins once all occupied paths finish. Empty groups do not delay the reunion. Missing branch targets preserve the old membership-only behavior: that group waits directly at the reunion.

The main display is black throughout selection and independent paths: no media, sound, title, QR or cursors. It resumes at the shared reunion. On group scenes, optional branch phone narration plays during selection; subsequent path scenes use their own phone narration. Keep phone-only audio in **Phone headphones**, not the display audio fields.

On ordinary components, **Phone headphones** accepts a broadcast MP3 plus optional per-group MP3 overrides. A group override wins; the broadcast file is used for participants without an override. Omitting both produces silence and resets the phone's previous cue.

## Scenario example

```json
{
  "version": "show-1",
  "groups": [
    { "id": "red", "label": "Red", "color": "#e5484d" },
    { "id": "blue", "label": "Blue", "color": "#3e63dd" }
  ],
  "initialGroupIds": ["red", "blue"],
  "entryPhaseId": "choose",
  "cyclesAllowed": false,
  "phases": [
    {
      "kind": "group-branch",
      "id": "choose",
      "title": "Listen for your group's instruction",
      "assignment": { "type": "balanced" },
      "branches": [
        { "groupId": "red", "weight": 1, "phoneAudioSrc": "red-instruction.mp3" },
        { "groupId": "blue", "weight": 1, "phoneAudioSrc": "blue-instruction.mp3" }
      ],
      "durationMs": 12000,
      "next": "shared-scene"
    },
    {
      "kind": "video",
      "id": "shared-scene",
      "src": "scene.mp4",
      "expectedDurationMs": 30000,
      "phoneAudioSrc": "broadcast.mp3",
      "phoneAudioByGroup": { "red": "red-layer.mp3", "blue": "blue-layer.mp3" },
      "next": "idle"
    },
    { "kind": "idle", "id": "idle" }
  ]
}
```

All phone audio references must be local MP3 files present in the show's media manifest. Studio includes group audio in its media analysis and deployment export.

## Live operation

The protected admin dashboard opens with the published show graph and live group locations. Select a scene to inspect its participant roster; use **Group to move** to jump one timeline to a scene on its own route. A jump starts that scene from the beginning and requires confirmation showing the affected group. The participant list also shows each phone's actual path and scene, independently of its membership label.

**Move to group** transfers a late arrival or existing participant into that group's current scene and playback position. It does not restart the destination or replay its external cues. Transfers update membership, socket routing, cursor/vote roster and personal audio together, and survive reconnects. Open votes are removed from the source; finalized results remain unchanged. A destination vote that has closed stays closed. An emptied source path stops and no longer holds up reunion. Moving into a completed group joins its silent reunion wait.

Groups that never started have no current playback position and are unavailable as transfer destinations. A parent group with running subgroups is also unavailable: choose the actual subgroup. A subgroup may retain its parent’s group ID; controls resolve to that descendant. If two concurrent sibling timelines reuse the same group ID, scoped controls are disabled rather than guessing a destination. The graph includes **Waiting / needs assignment** for phones outside any active roster. Search finds participants across the show.

Assignments are process-local session state and contain participant IDs only; they are cleared when the session ends. Vote-derived membership uses the finalized individual outcome from the referenced question. Balanced assignment is deterministic and weighted, so reconnects do not randomly reshuffle the room.

## Multiple displays and rehearsal

Open the usual display URL with `group=<group-id>` added to its query string, for example `/display/?group=red`. A display without `group` is the main display. Each group has one authenticated display slot; reconnecting or replacing a group display does not replace main or another group display. Group displays stay black outside their active paths and use only their own roster's cursor feed. Media duration fallback still advances a path when its group display is unavailable.

Path rosters are created at selection close and can then be changed by an operator transfer. Late visitors wait silently until assigned or until the shared reunion. Nested splits run within their parent path; transfers into or out of a subgroup update all ancestor rosters. The outcome preview can follow one selected group path at a time.

Personal audio is cued at the elapsed time on the destination scene's authoritative clock, including time spent uploading/resetting the stream. Recovery and late audio registration retain that clock. This is a live-stream alignment, not a guarantee of sample-accurate synchronization between different phones: encoder, network and browser buffers still contribute latency. Rehearse transfers with the actual venue audio backend and locked phones.

Deploy the server, admin, phone and audio bridge changes together. The bridge now accepts `offsetSeconds` on `/players/{id}/play`; an older bridge ignores that field and would restart the file. Snapshot/phase messages include a participant `routingEpoch`, allowing phones to accept a transfer to an older destination scene epoch while rejecting frames from their previous route.

Rebuild and deploy Studio, display, phone, and server together, then hard-refresh displays to replace their service-worker bundle. Rehearse with two phones and a display per group: pick different groups, finish one first, check that main remains black, then finish the other and check the shared reunion. Automated tests cover this routing but do not replace a venue rehearsal.
