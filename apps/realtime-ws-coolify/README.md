# @smartphonecracy/realtime-ws-coolify

Room-scoped uWebSockets.js cursor relay -- same logic as
`apps/realtime-ws`, repackaged into the flat, plain-JS layout of
[manegame/uwebsocket-server](https://gitlab.com/manegame/uwebsocket-server),
a Coolify deployment this org has already run successfully. Use this
package when you want to deploy exactly the way that repo's guide
describes; `apps/realtime-ws` (TypeScript, monorepo-integrated) is the
one to keep developing day to day.

## Why this exists as a separate package

`apps/realtime-ws` runs its source through `tsx` and isn't laid out the
way the proven Coolify deployment expects (flat directory, plain
`node websocket-server.js`, `npm ci` against a committed
`package-lock.json`). Rather than fight that mismatch, this package
mirrors the known-good structure directly:

- Flat directory, no `src/` nesting.
- Plain CommonJS (`require`), no TypeScript/`tsx` at runtime.
- `node:20-alpine` + `npm ci --only=production`, exactly like the
  reference repo.
- `package-lock.json` is committed. This is what actually makes
  `npm ci` work without `git` in the image -- once `uWebSockets.js` is
  pinned to a resolved commit in the lockfile, npm fetches it straight
  from GitHub's tarball endpoint. (The reference repo's own
  `pnpm-lock.yaml` does the same thing for `pnpm`; it just doesn't
  commit the `package-lock.json` that `npm ci` in its own Dockerfile
  needs.)
- `start.sh` bumps `ulimit -n` before starting, same as the reference.

## Usage

```bash
pnpm --filter @smartphonecracy/realtime-ws-coolify start   # http://localhost:9001
```

Same wire protocol as `apps/realtime-ws` -- see that package's README.

## Deploying on Coolify

Follow the reference repo's guide, substituting the base directory:

1. **New Resource -> Application -> Dockerfile build pack**, pointed at
   this repo/branch.
2. **Base Directory**: `apps/realtime-ws-coolify`.
3. **Ports Exposes**: `9001`.
4. **Env vars**: `WS_PORT=9001`, `NODE_ENV=production`.
5. **Health check**: HTTP, path `/health`, port `9001`.
6. Pick a networking mode:
   - Keep Coolify's default Traefik domain and enable SSL on it for
     `wss://your-domain` -- simplest, no firewall changes.
   - Or enable **"Map to Host"** (container port `9001` -> public port
     `9001`) if you hit WS instability through the proxy -- the
     reference guide calls this the safer default; it means opening
     `9001` in the host firewall and terminating TLS yourself if you
     need `wss://`.
