# Fonts

## Optik (not in git)

The audience-facing surfaces use **Optik** (Playtype): the native app, `/phone/`,
the main display and the credits render. It is a commercial font licensed to one
person, and Playtype's EULA forbids making the font files publicly downloadable.
This repository is public, so the files are gitignored.

Copy the licensed files into `fonts/optik/` with their original names:

```
fonts/optik/Optik-Regular.woff2   fonts/optik/Optik-Regular.ttf
fonts/optik/Optik-Bold.woff2      fonts/optik/Optik-Bold.ttf
fonts/optik/Optik-Italic.woff2    fonts/optik/Optik-Italic.ttf
```

The web apps use the `.woff2` files; the native app uses the `.ttf` files.

Without these files everything still builds, and each surface uses its fallback
font instead (system UI on web and native). So a build only shows Optik if it
ran on a machine that has the files:

- **Web bundles** (phone, display): build them where `fonts/optik/` is
  populated. Vite prints `didn't resolve at build time` for the font URLs when
  the files are missing. The Coolify server image is built from git, so a
  deployed server ships the fallback until the fonts reach that build (#285).
- **Native app:** EAS Update (`pnpm update:production`) exports the bundle
  locally, so it includes Optik when the files are present here. EAS cloud
  *builds* upload a gitignored-filtered copy of the project and therefore ship
  the fallback until the next update.
- **Credits:** run `pnpm --filter @entertheblackbox/credits render` where the
  files are present.

Studio and Admin keep their own open-licensed fonts in `packages/tool-ui`.
