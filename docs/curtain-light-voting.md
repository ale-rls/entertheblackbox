# Curtain-light votes

Cursor votes for a group marked **Curtain-light cursor votes** are drawn as
light on a moving curtain instead of the usual field overlay. The treatment
is adapted from the Curtain Light Lab prototype (packed curtain video plus a
relighting shader). Other groups' votes are unchanged.

## Setting it up in Studio

1. **Groups** (toolbar) → tick *Curtain-light cursor votes* on the theater
   group. The group should vote with phone cursors.
2. Under **Shared curtain**, choose the packed curtain video from the media
   library. The default video is the *Silver B · lamé* curtain. Upload the clip through
   the media library like any other show media; it is published with the show
   (Studio → Publish show) and must never be committed to git.
3. Every position question on that group's own path (from its group-branch
   output up to the shared reunion) is a curtain stage. Selecting one shows a
   **Curtain light** section with:
   - a light preview with sample cursors and a simulated vote;
   - answer colours, with *Reset colours to system defaults*;
   - *Neutral gap* (closed by default): the gap between answer areas for
     this stage only. *Use the shared neutral gap* removes the override.

Fabric and light levels are not set in Studio. They are fixed in code
(`CURTAIN_DEFAULTS` in `packages/shared/src/curtain.ts`), tuned for Silver B ·
lamé on the projector: original picture 0.31, folds, sheen and shadows 0,
answer-area glow and cursor floods 0. Light values saved in older shows, in
`curtainLight` or a stage's `lightTuning`, still load but are ignored.

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

### Over the open curtain

A curtain vote normally draws its light on the shared, closed curtain. When the
video curtain is open (Teil 2, Act 2), tick **Draw the light over this scene's
loop video** (`curtainOverSceneLoop: true`) on the vote: the light, labels and
cursors are drawn over the scene's own `loopVideoSrc` (for example the open
curtain loop), so the stage stays visible. That video is used as a plain
picture (no folds or relief); the scene needs a loop video, or validation fails.

The same works on the closed curtain, and keeps it one continuous bed: give the
titles and votes of a closed-curtain stretch the same loop video as the scenes
around them and tick the box on the votes. The loop then never restarts (the
server keeps its clock across scenes that share it), and the lit curtain draws
the frames of the loop already on screen rather than playing its own copy. A
plain loop is read as the picture the loop layer shows: at the curtain's
starting level it looks exactly like the loop, and lower levels match the title
dim. Chrome composites a `<video>` a few percent differently from WebGL, so the
lit curtain fades in over the loop across the dim-in second instead of
replacing it on one frame.

### Positioning before the choice

Some cues ask people to move onto fields that should **not** light up yet: the
choice comes in a later vote ("Cursor und Felder bleiben sichtbar, lösen aber
noch kein Feld aus"). Two settings on a curtain vote cover this:

- **Fields don't light up yet** (`curtainFieldsStatic: true`): every field
  keeps its base glow and a cursor's flood looks the same inside and outside a
  field. Votes are still counted and recorded as usual.
- **Keep cursors from the previous curtain vote** (`curtainKeepCursors: true`):
  when the scene before was also a curtain vote, cursors that were showing stay
  where they are instead of hiding until the next touch. People who had not
  touched yet still enter at the neutral point. After a scene without curtain
  light the setting has no effect.

Both only apply to curtain votes; validation warns when they are set elsewhere.
As with every video vote, a cursor that is carried over counts once its
participant moves it while the window is open.

### Cursors outside curtain votes

Every other scene that shows cursors (`showCursors`, plain votes included)
draws them in the same look as the curtain's cursor cores: a soft light in the
participant's colour lifted towards white, swelling when the phone is touched,
added onto whatever the scene shows (`mix-blend-mode: plus-lighter`). The
scene's picture stays visible; only curtain votes replace it with the curtain.
Code: `apps/display/src/cursors/glowCursor.ts`.

## What the audience sees

| Layout | Treatment |
|---|---|
| Left/right, top/bottom vote | Two pools separated by unlit space |
| Horizontal / vertical spectrum | Two neutral washes either side of an unlit centre band; light grows toward the ends |
| Four quadrants | Four pools with an unlit cross; axis-end labels |
| Three candidates / custom zones | Light shaped to each zone with soft edges; space between zones is neutral |

Fields are lit in one neutral, slightly warm white (`CURTAIN_NEUTRAL_POOL_COLOR`)
and divided by a thin, soft white cross through the middle of the neutral gap
(one line for a left/right or top/bottom vote; custom zones get outlines instead). The
answer colours are not used on the curtain; they still tint M1–M4 and the
phones. Pools keep a base glow and brighten with their share of the
authoritative live counts, smoothed and capped. Areas never move or grow with
popularity.

Each cursor is a small bright centre tinted in its participant's own colour
(the identity colour the server assigns on join and the phone shows as its
background, `PARTICIPANT_COLORS`) with a soft flood in the same warm white as
the fields. Only the centre carries the identity colour, so people can find
themselves while the fabric stays one neutral light; with many participants,
coloured floods read as confetti. A flood strengthens once it stands in a
counting area. The title
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
- Entry state resets between stages, unless the next stage keeps cursors. Reconnecting mid-stage resumes the
  cursor where it was; the server stays authoritative for position and votes.

## Timing

Ordinary position questions and video-timed position questions keep their
authored timing. The curtain is up from the scene's first video frame, so a
vote after a closed-curtain scene never dips to black. A freshly shown lit
curtain starts at about the plain curtain video's brightness and dims to its
own level over one second; a vote straight after another keeps it as it is.
A title (a narration scene with text over a loop video) dims its loop to the
vote's level the same way: it redraws each pixel with the lit curtain's own
curve at `baked` 0.31, easing in over one second and back out into the next
scene (`apps/display/src/curtain/titleDim.tsx`). A vote that is not drawn as
curtain light but runs over a loop (the open-curtain votes) dims that loop the
same way under its labels; the scene before it dims in during its last second
and consecutive ones stay dimmed (`packages/shared/src/backdropDim.ts`). A vote
right after a title starts at the title's level, with no dim-in. On video-timed
questions the question, labels, lit areas and cursors appear at once at
`showAtMs`, and the curtain fades out by `hideAtMs`. When a vote closes the server stops accepting votes, the
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

## Casting spotlights

On a main-timeline **Position question** with a fixed target, enable
**Use spotlights on the main display** in Studio. Set the countdown, the
spotlight diameter as a percentage of the screen height, and how long to hold
the final positions. The main display uses the shared curtain video when
configured, or a built-in fabric pattern. It requires WebGL2.

Participants steer their spots with the browser trackpad. When the countdown
ends, the server holds their last positions and then advances to the fixed
target. Casting is decided in the room. Rehearse diameter, brightness and hold
time on the gauze before using the cue in a performance.
