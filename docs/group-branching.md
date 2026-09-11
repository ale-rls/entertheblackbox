# Group branching and targeted audio

Runtime schema version 5 makes audience groups first-class show state. Studio authors can define a stable group catalogue, start a session with multiple balanced groups, add a **Group branch** component, and attach either broadcast or group-specific phone narration to later phases.

## Authoring in Studio

Open the show properties with no component selected to edit the group catalogue and the initial groups. A show can begin with two or more initial groups; the server balances admitted participants across them when the session starts.

Add a **Group branch** component at the moment membership should change. Its inputs are an optional source cohort and one assignment rule. Its outputs are two or more group memberships:

- **Balanced** distributes the source cohort according to output weights.
- **From vote** maps each participant's result from an earlier position question to a group, with a required fallback.
- **Manual** keeps a participant's operator-assigned output group and sends anyone else to the fallback.

The component is synchronized: it changes membership atomically, plays each output group's phone cue for its authored duration, and then advances the shared display timeline through `next`. It does not yet create independent display timelines for each group.

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

## Current boundary

This release branches **membership and phone content**, while the installation display and phase clock remain shared. Fully independent per-group visual paths require a later multi-lane scheduler with explicit regroup barriers; the current model deliberately avoids implying that those independent timelines already exist.
