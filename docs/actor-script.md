# Shared actor script

In Admin, open **Script**, paste a title and plain-text script, and choose **Load script**. Blank lines separate cue paragraphs; line breaks inside a paragraph are preserved. Scripts may contain up to 200,000 characters and 2,000 paragraphs.

Share the **Read-only actor link** with performers. They can open it in any browser on the venue network without operator credentials. The link grants access to this private script, so share it only with the cast. It never permits controlling the show or advancing cues. Text is rendered literally, not as HTML.

The operator uses **Next cue**, **Previous cue**, or **Cue here**. Actors see the current paragraph highlighted and follow its position automatically. Turn off **Follow shared cue** to read ahead; **Return to cue** rejoins the shared position. Text size is local to each reader. Cue changes are fetched every second and do not affect audience playback. The reader reports connection loss and reconnects automatically.

**Replace reader link** revokes the previous link. Loading a replacement script also revokes old links and resets the cue. **Clear script and revoke link** removes the script from the server. Revocation stops future reads; it cannot recall text already seen or copied.

Script state is held only in server memory: it is lost on restart and is not part of Studio publishing or scenario backups. Keep the original script separately. Do not commit performance scripts to this public repository. This first version supports one shared script and one operator cue at a time; actors scroll independently when follow is off.
