# Fonts

## Optik (not in git)

The audience-facing surfaces use **Optik** (Playtype): the native app, `/phone/`,
the main display, M1–M4 monitors and the credits render. It is a commercial font
licensed to one person, and Playtype's EULA forbids making the font files
publicly downloadable from the repository. This repository is public, so the
files are gitignored.

Copy the licensed files into `fonts/optik/` with their original names:

```
fonts/optik/Optik-Regular.woff2   fonts/optik/Optik-Regular.ttf
fonts/optik/Optik-Bold.woff2      fonts/optik/Optik-Bold.ttf
fonts/optik/Optik-Italic.woff2    fonts/optik/Optik-Italic.ttf
```

The web apps use the `.woff2` files; the native app uses the `.ttf` files.
Without them every surface falls back to the system font.

### Web pages (phone, display, monitors): served at runtime

The `/phone/` and `/display/` bundles do not contain the font. Their CSS loads
`/fonts/Optik-*.woff2`, which the server serves from `FONTS_DIR` (default
`fonts/optik/` in the repository root). A build without the files is identical
to one with them, and fonts can be added or replaced without rebuilding: reload
the pages. Vite prints `didn't resolve at build time` for these URLs; that is
expected. The display service worker caches the fonts so a screen keeps Optik
through a server outage.

**Coolify:** the `frontend` service mounts the `optik-fonts` volume at
`/app/fonts/optik` (`deploy/coolify/docker-compose.yml`). Copy the three `.woff2`
files onto it once, for example from your machine:

```bash
scp fonts/optik/Optik-*.woff2 <server>:/tmp/
# on the server
docker cp /tmp/Optik-Regular.woff2 <frontend-container>:/app/fonts/optik/
docker cp /tmp/Optik-Bold.woff2    <frontend-container>:/app/fonts/optik/
docker cp /tmp/Optik-Italic.woff2  <frontend-container>:/app/fonts/optik/
```

Then check `https://<frontend>/fonts/Optik-Regular.woff2` returns the font.
The files persist across redeploys; only deleting the volume removes them.

### Native app and credits: bundled at build time

- **Native app:** EAS Update (`pnpm update:production`) exports the bundle
  locally, so it includes Optik when the files are present here. EAS cloud
  *builds* upload a gitignored-filtered copy of the project and therefore ship
  the fallback until the next update.
- **Credits:** run `pnpm --filter @entertheblackbox/credits render` where the
  files are present.

Studio and Admin keep their own open-licensed fonts in `packages/tool-ui`.
