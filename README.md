# Smartphonecracy Runner

Smartphonecracy Runner is the runtime and visual authoring toolkit for a browser-based, multiplayer installation. Visitors scan a QR code, use their phones as cursors, and collectively navigate questions and video branches on a shared display.

The server is authoritative: it manages admission, room state, timed vote snapshots, branch resolution, recovery, persistence, and the operational admin API. Shows are versioned scenario graphs rather than hard-coded application flows.

## Applications

- `apps/server` — Fastify HTTP and WebSocket server, phase engine, admission, persistence, and admin API.
- `apps/display` — fullscreen React client for the installation screen.
- `apps/phone` — mobile React controller used by participants.
- `apps/admin` — protected operational interface.
- `apps/studio` — local visual editor for importing, authoring, validating, previewing, and exporting shows.

Shared runtime contracts live in `packages/protocol`, `packages/scenario`, `packages/shared`, and `packages/studio-adapter`.

## Requirements

- Node.js 22 or newer
- pnpm 9.12.2

## Setup

From a fresh clone, run all commands from the repository root:

```bash
cd smartphonecracy
corepack enable
pnpm install
```

The checked-in development scenario and media manifest are used by default. No database is required for local development; persistence is enabled when `DATABASE_URL` and the related production configuration are supplied.

## Run locally

Build the three installation clients once (and rebuild them after frontend changes):

```bash
pnpm --filter @smartphonecracy/display build
pnpm --filter @smartphonecracy/phone build
pnpm --filter @smartphonecracy/admin build
```

Then start the installation server and leave it running:

```bash
env HOST=127.0.0.1 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=test node --import tsx apps/server/src/index.ts
```

Open the authenticated installation display:

<http://127.0.0.1:3000/display/?installation=dev-installation&room=main&token=dev-display-token>

The query parameters identify the installation and room and authenticate this browser as the official display. The server allows only one authenticated display connection. The root page (`http://127.0.0.1:3000/`) redirects to an unauthenticated `/display/` fallback: it can show the attract visuals, but it cannot receive the live QR code or installation state.

The server also exposes:

- `/phone/` — participant controller
- `/admin/` — operations interface
- `/healthz` and `/readyz` — health and readiness checks

Development credentials in the server configuration are intentionally local-only defaults. Set strong `ADMIN_TOKEN`, `JOIN_GRANT_SECRET`, display credentials, and production URLs before deployment.

### Run the checked-in `showtest1` show

The normal command loads the default development show. To run `showtest1`, stop the installation server with `Ctrl+C` and restart it with its checked-in scenario and media manifest:

```bash
env HOST=127.0.0.1 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=test SCENARIO_PATH=content/scenarios/showtest1.json MEDIA_MANIFEST_PATH=content/media-manifests/showtest1.json node --import tsx apps/server/src/index.ts
```

Studio drafts and deployment exports do not automatically publish to the running installation. Restarting the server with these paths is what selects the checked-in show locally.

### Connect a physical phone

The installation server already serves the phone client; no second phone server is needed. Find the Mac's LAN IP (often `ipconfig getifaddr en0` on macOS), substitute it below, and start the server with a network-visible host and QR destination:

```bash
env HOST=0.0.0.0 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=test PHONE_JOIN_BASE_URL=http://192.168.1.23:3000/phone/ node --import tsx apps/server/src/index.ts
```

Keep the authenticated display open on the Mac as above, then scan its QR code. The phone and Mac must be on the same Wi-Fi network, and the macOS firewall must allow incoming connections to Node.js on port 3000. Do not use `localhost` in `PHONE_JOIN_BASE_URL`: on the phone, that means the phone itself.

To run `showtest1` and accept physical phones at the same time, combine both sets of environment variables:

```bash
env HOST=0.0.0.0 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=test PHONE_JOIN_BASE_URL=http://192.168.1.23:3000/phone/ SCENARIO_PATH=content/scenarios/showtest1.json MEDIA_MANIFEST_PATH=content/media-manifests/showtest1.json node --import tsx apps/server/src/index.ts
```

### Stale display or missing video

The display uses an app-shell service worker and Cache Storage. After rebuilding, close duplicate display tabs and hard-refresh (`Cmd+Shift+R` on macOS or `Ctrl+Shift+R` elsewhere). If the old shell persists, open the authenticated URL on the other local hostname (`localhost` instead of `127.0.0.1`, or vice versa); those origins have separate browser storage. As a last resort, unregister the service worker and clear site data in the browser's developer tools, then reload the authenticated URL.

## Show Studio

Start the local authoring tool with:

```bash
pnpm --filter studio dev
```

Run this in a second terminal while the installation server remains running, then open <http://localhost:5173>.

Studio supports graph editing, typed transitions, media diagnostics, runtime validation, branch preview, local draft recovery, and versioned deployment exports. It does not publish directly to a running installation.

See [the Studio curator guide](docs/studio-guide.md) and [runtime compatibility notes](docs/studio-compat.md).

## Validate and test

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm validate-scenario
```

The end-to-end suite builds the installation clients and runs Playwright flows against real server processes. Some environments require permission to bind local ports.

To exercise the multiplayer server without browsers:

```bash
pnpm simulate-clients
```

## Content

- `content/scenarios/dev.json` — example development show
- `content/scenarios/showtest1.json` — checked-in `showtest1` show
- `content/media-manifest.json` — development media inventory
- `content/media-manifests/showtest1.json` — media inventory for `showtest1`
- `content/media/` — locally served media assets

Scenarios and manifests are validated at startup and before Studio deployment export. Visual Studio layout metadata remains separate from runtime JSON.

## Deployment and operations

The current production design targets a single authoritative Fly.io server, Supabase Postgres for durable events and checkpoints, and externally hosted media — but whether production runs in the cloud or on-premises at the venue is an open decision ([#37](https://github.com/ale-rls/smartphonecracy-runner/issues/37)). Deployment is manually gated and must happen while the venue is closed.

- [Deployment and rollback](docs/deployment.md)
- [Operations runbook](docs/operations.md)
- [Venue installation guide](docs/venue-installation.md)
- [Persistence model](docs/persistence.md)

The application and Show Studio v1 are implemented and tested. A real venue launch still requires production content and privacy approval, infrastructure provisioning, exact-hardware acceptance, and the final soak test.

## Project status

Open work is tracked in [GitHub issues](https://github.com/ale-rls/smartphonecracy-runner/issues); the agent process is described in [docs/agent-workflow.md](docs/agent-workflow.md). Historical implementation and verification records (steps 000–048) are preserved in [steps.md](steps.md), now retired. Director policy decisions live in [docs/director-decisions.md](docs/director-decisions.md). The only deferred Studio feature is the post-v1 multi-participant drag simulator; outcome shortcuts cover the same resolution branches in v1.

## License

No license has been declared yet. All rights are reserved unless a license file is added.
