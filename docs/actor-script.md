# Shared actor script

## From the show (Studio)

In Studio, click empty canvas to open **Show properties** and fill in **Actor script** (title and plain text; blank lines separate paragraphs). Then select a scene and use **Actor script cues**: each cue has a start time in milliseconds from scene start and the paragraph the reader jumps to. Studio's diagnostics block publishing while a cue points past the end of the script.

The script publishes with the show. When the server loads that show, Admin → **Script** uses it automatically and the read-only actor link stays the same across server restarts (until **Replace reader link**, which lasts until the next restart, or until a different show version is published). Scene cues follow the main timeline only; cues on an independent group path are ignored. Operators can still use **Previous cue**, **Next cue** or **Cue here**; that position holds until the next scene cue fires.

The script is stored in the Studio draft, which anyone who can reach the Studio PocketBase collection can read. Do not commit it to this repository. Script cues are not sent to phones or displays.

## Loaded in Admin (override)

In Admin, open **Script**, paste a title and plain-text script, and choose **Load script**. Blank lines separate cue paragraphs; line breaks inside a paragraph are preserved. Scripts may contain up to 200,000 characters and 2,000 paragraphs.

Share the **Read-only actor link** with performers. They can open it in any browser on the venue network without operator credentials. The link grants access to this private script, so share it only with the cast. It never permits controlling the show or advancing cues. Text is rendered literally, not as HTML.

The operator uses **Next cue**, **Previous cue**, or **Cue here**. Actors see the current paragraph highlighted and follow its position automatically. Turn off **Follow shared cue** to read ahead; **Return to cue** rejoins the shared position. Text size is local to each reader. Cue changes are fetched every second and do not affect audience playback. The reader reports connection loss and reconnects automatically.

**Replace reader link** revokes the previous link. Loading a replacement script also revokes old links and resets the cue. **Clear script and revoke link** removes the script from the server. Revocation stops future reads; it cannot recall text already seen or copied.

A script loaded in Admin overrides the show's script and ignores scene cues; **Clear** returns to the show's script at its latest fired cue. An Admin-loaded script is held only in server memory: it is lost on restart and is not part of Studio publishing or scenario backups. Keep the original script separately. Do not commit performance scripts to this public repository. This first version supports one shared script and one operator cue at a time; actors scroll independently when follow is off.
