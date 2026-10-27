# Native participant player

Expo SDK 55 / React Native app for an owned iPhone and Android fleet, with an eventual store release path. Start with [the setup and rehearsal guide](../../docs/native-player.md).

From this directory:

```sh
pnpm start                 # development build, not Expo Go acceptance testing
pnpm ios                   # local Xcode build
pnpm android               # local Android build
pnpm typecheck
pnpm test
```

The server still owns the show graph, groups, votes and phase times. Before every join, this app checks the selected published show channel, downloads/verifies its MP3s, then joins the existing `/ws` protocol, and plays the participant's assigned audio from persistent device storage. Store publication and physical background reliability are not established by the scaffold's automated tests.
