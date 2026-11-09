# Publish a show once

For script revisions, private backup edits and the required left-to-right canvas
layout, first follow [Updating shows](updating-shows.md).

1. Open the show in Studio on the venue server (`/studio/`). Upload its videos, images and MP3s in **Media library**, and resolve Diagnostics.
2. Click **Publish** at the top right of the editor (disabled until Diagnostics are resolved). Sign in as an operator, confirm the name and optionally choose background music, then **Publish**.
3. The server checks the graph and referenced media, freezes the assets, prepares native downloads, saves one version and selects it automatically. Main projection, M1–M4 and native devices all follow that version. There is no separate monitor or phone publication.
4. Open the display pages and let their caches finish. On native devices use **Download / update show** ahead of admission, then **Update show & join**. Each join checks the server's active version and reuses verified cached files.
5. Start the performance in Admin. Publishing during a running performance queues activation until it ends; new joins during that performance still download its running version.

Show publication changes content. Installing/updating the application software is needed only when application features change; it is not a step for each show edit. Browser display software ships with the server deployment. Native application code ships through EAS Update or an installed build as described in [native-player.md](native-player.md).

## Version and failure behavior

Each publication gets a fresh scenario version and an immutable native release ID. Referenced videos, images and audio are copied to content-addressed `native-shows/assets/`; native audio also has the existing verified `native-shows/audio/` download representation. This directory is on the persistent production volume. Keep old assets: a performance in progress or an older saved show may still need them.

Invalid graphs, missing media, changed hashes or invalid native audio prevent the scenario from being saved. Unused media-library files are not part of the release. Concurrent publication requests are rejected. A stale production baseline requires Studio's explicit overwrite action. If saving succeeds but automatic selection fails, Studio reports that partial result and directs the operator to Admin → Active show; it does not claim that nothing was saved. PocketBase record creation and active selection are separate storage operations; activation happens only after publication finishes and the current show is idle.

Both legacy `native-shows/channels/rehearsal.json` and `production.json` URLs now serve the release belonging to the running scenario. This keeps installed clients working without independent channel choices. The old device-only publish API returns 410. The historical CLI can prepare offline native assets, but changing its channel pointer does not change downloads served by the venue runtime. Existing scenarios without a native release ID prepare their phone assets on first download; publish them once through Studio to freeze all media and assign a unique version.

Phones joining across a show change are asked to rejoin with the new content. A server restart reconnects displays, which refresh their media manifest on scenario-version changes. A queued publication is not downloadable as the active show until activation. Use an independent venue server for a simultaneous native rehearsal; Studio's isolated browser display preview is not a second phone release channel.

To restore an earlier version, import its saved Studio backup and publish it through the same action. Admin's Active show selector selects the latest publication of a different show ID; it is not a per-version rollback control.

Physical playback, fullscreen behavior and device timing still need venue rehearsal. Publishing verifies files and versions, not that every device has finished downloading or that a loudspeaker is audible.
