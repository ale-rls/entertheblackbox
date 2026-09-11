# Group timelines, voting, and show-control cues

The Studio can split one running show into independent group timelines. A `group-branch` assigns the selected audience members, starts each occupied branch at its own `branches[].next`, and rejoins the shared timeline at the branch node's `next` only after every occupied branch arrives there.

```json
{
  "groups": [
    { "id": "theater", "label": "Theater", "votingMethod": "physical" },
    { "id": "ki", "label": "KI", "votingMethod": "phone-buttons" },
    { "id": "stage", "label": "Bühne", "votingMethod": "phone-buttons" },
    { "id": "craft", "label": "Gewerk", "votingMethod": "phone-buttons" },
    { "id": "decision", "label": "Entscheidung", "votingMethod": "phone-buttons" }
  ],
  "phases": [
    {
      "kind": "group-branch",
      "id": "theater-or-ki",
      "title": "Wähle deine Gruppe",
      "assignment": { "type": "self-select" },
      "durationMs": 15000,
      "branches": [
        { "groupId": "theater", "next": "theater-opening" },
        { "groupId": "ki", "next": "ki-opening" }
      ],
      "next": "reunion"
    },
    {
      "kind": "group-branch",
      "id": "ki-role",
      "title": "Wähle deine KI-Rolle",
      "sourceGroupIds": ["ki"],
      "assignment": { "type": "self-select" },
      "durationMs": 15000,
      "branches": [
        { "groupId": "stage", "next": "stage-path" },
        { "groupId": "craft", "next": "craft-path" },
        { "groupId": "decision", "next": "decision-path" }
      ],
      "next": "ki-reunion"
    }
  ]
}
```

The three group voting methods are:

- `physical`: only TrackingBox positions count. For a group-scoped physical vote, the tracked body must be bound to that phone participant so the server can route it to the correct group timeline.
- `phone-cursor`: the phone is the relative trackpad used by existing shows.
- `phone-buttons`: the phone shows one button per answer region. Two-way fields show two buttons; the current four-way field shows four.

Omitting `votingMethod` preserves existing scenarios: physical positions and phone cursors are both accepted.

Every video, question, video-question, or group branch can declare one-shot external cues:

```json
{
  "kind": "video",
  "id": "ki-opening",
  "src": "ki-opening.mp4",
  "expectedDurationMs": 42000,
  "outgoingCues": ["td.screen.ki.opening", "lights.ki.blue"],
  "next": "ki-role"
}
```

TouchDesigner can subscribe to `GET /api/cues` as a Server-Sent Events stream. Send the same secret used by a display as `Authorization: Bearer <DISPLAY_TOKEN>`. Each JSON event has `version`, `bootId`, `sequence`, `type`, `timelineId`, `sessionId`, `phaseId`, `phaseEpoch`, `timestamp`, and `payload`. The stream sends a `snapshot` first so a reconnecting receiver can restore every active timeline. Later events are `phase`, `cue`, `result`, or `reset`.

```sh
curl -N -H "Authorization: Bearer $DISPLAY_TOKEN" http://studio-host:3000/api/cues
```

Use `bootId` plus `sequence` for deduplication. Treat `cue` as a one-shot trigger. Treat `snapshot` and `phase` as current state, so reconnecting TouchDesigner does not replay an old one-shot cue.
