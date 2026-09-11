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

The protected admin dashboard shows every connected participant's current group. Selecting another group updates membership immediately. If the active component has targeted phone audio, that phone is reset and starts the newly selected group's current cue immediately.

Assignments are process-local session state and contain participant IDs only; they are cleared when the session ends. Vote-derived membership uses the finalized individual outcome from the referenced question. Balanced assignment is deterministic and weighted, so reconnects do not randomly reshuffle the room.

## Multiple displays and rehearsal

Open the usual display URL with `group=<group-id>` added to its query string, for example `/display/?group=red`. Keep the same installation, room and display credentials. A display without `group` is the main display. Each group has one authenticated display slot; reconnecting or replacing a group display does not replace main or another group display. Group displays stay black outside their active paths and use only their own roster's cursor feed. Media duration fallback still advances a path when its group display is unavailable.

Membership is frozen into path rosters at selection close. An operator assignment during a path changes the membership/audio override, not the phone's active path; use a later group scene to route it again. Late visitors without a path wait for the shared reunion. A new split must be at or after the reunion; nested splits inside a running group path are rejected on validation. The outcome preview can follow one selected group path at a time.

Rebuild and deploy Studio, display, phone, and server together, then hard-refresh displays to replace their service-worker bundle. Rehearse with two phones and a display per group: pick different groups, finish one first, check that main remains black, then finish the other and check the shared reunion. Automated tests cover this routing but do not replace a venue rehearsal.
