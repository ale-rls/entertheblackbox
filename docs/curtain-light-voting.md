# Curtain-light votes

Cursor votes for a group marked **Curtain-light cursor votes** are drawn as
light on a moving curtain instead of the usual field overlay. The treatment
is adapted from the Curtain Light Lab prototype (packed curtain video plus a
relighting shader). Other groups' votes are unchanged.

## Setting it up in Studio

1. **Groups** (toolbar) → tick *Curtain-light cursor votes* on the theater
   group. The group should vote with phone cursors.
2. Under **Shared curtain**, choose the packed curtain video from the media
   library. The default fabric is *Silver D · satin*. Upload the clip through
   the media library like any other show media; it is published with the show
   (Studio → Publish show) and must never be committed to git.
3. Every position question on that group's own path (from its group-branch
   output up to the shared reunion) is a curtain stage. Selecting one shows a
   **Curtain light** section with:
   - a light preview with sample cursors and a simulated vote;
   - answer colours, with *Reset colours to system defaults*;
   - *Rehearsal tuning* (closed by default): neutral gap and light levels for
     this stage only. *Use shared curtain settings* removes the overrides.

Fabric and default light levels live under *Shared curtain → Fabric and
light tuning*.

### A single vote on the shared timeline

A vote that is not on a group's own path (for example a question both
audiences answer together after a reunion) can be drawn as curtain light on
its own: select it and tick **Draw this vote as curtain light**
(`curtainLightVote: true`). It then counts as a curtain stage with the same
rules, the shared curtain video is required, and the **Curtain light** section
appears. Everyone whose input reaches that vote, including late joiners
without a group, gets the curtain entry and relative steering. Custom zones
that tile the whole screen leave no neutral entry point and are rejected:
leave an unlit gap between them.

## What the audience sees

| Layout | Treatment |
|---|---|
| Left/right, top/bottom vote | Two pools separated by unlit space |
| Horizontal / vertical spectrum | Opposing coloured washes, continuous colour transition, unlit centre band; light grows toward the ends |
| Four quadrants | Four pools with an unlit cross; axis-end labels |
| Three candidates / custom zones | Light shaped to each zone with soft edges; space between zones is neutral |

There are no borders, grid lines or dividing strokes. Pools keep a base glow
and brighten with their share of the authoritative live counts, smoothed and
capped. Areas never move or grow with popularity.

Each cursor is a bright centre with a soft flood, tinted toward nearby answer
colours. Its flood strengthens once it stands in a counting area. The title
and labels stay visible throughout in white, with a soft dark halo for contrast
over both lit pools and unlit fabric.

## Entry and identification

- At the start of each stage every cursor is hidden and uncounted.
- A participant's first touch reveals their cursor at the stage's neutral
  entry point (the field centre, or the nearest neutral point if a custom
  zone covers the centre). Appearing never casts a vote.
- From there the phone control steers the cursor relatively; each new touch
  briefly pulses that participant's centre (the native app flags touch
  starts; older app builds still steer, with pulses only on entry).
- Entry state resets between stages. Reconnecting mid-stage resumes the
  cursor where it was; the server stays authoritative for position and votes.

## Timing

Ordinary position questions and video-timed position questions keep their
authored timing. Video-timed questions fade the curtain in at `showAtMs` and
out by `hideAtMs`. When a vote closes the server stops accepting votes, the
pools settle back to their base glow (no winner spotlight), cursor lights
fade, and the lit curtain fades into the next scene.

## Counting

Curtain stages count with a neutral gap on two-way and four-quadrant fields
(default 0.06 of the screen; set per show or per stage). Positions inside the
gap count for nothing, exactly like positions outside custom zones. Field
calibration (arena ellipse/quad, off-centre splits) is preserved. Validation
fails a curtain stage when an answer has no usable area, when no neutral
entry point exists, or when the shared curtain video is missing, and warns
about labels too long to read.

## Making a packed curtain video

The prototype's `tools/make_maps.py` builds one from a 1280×704, 24 fps clip:
colour top-left, normal X top-right, normal Y bottom-left, depth
bottom-right, 2560×1408 in total. Normal and depth tiles must not be colour
managed or tone mapped.
