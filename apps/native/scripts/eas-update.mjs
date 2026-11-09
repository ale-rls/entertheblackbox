// Publishes an EAS Update for iOS and Android only.
// `eas update` defaults to --platform all, which also exports web and fails without react-native-web.
// Declaring `platforms` in app.config.ts would avoid that, but it changes the runtime fingerprint and
// would make the update incompatible with installed builds. eas update takes one platform per run.
import { spawnSync } from 'node:child_process';

const [channel, ...args] = process.argv.slice(2);
if (!channel) {
  console.error('usage: node scripts/eas-update.mjs <channel> --message "..."');
  process.exit(1);
}
for (const platform of ['ios', 'android']) {
  const { status } = spawnSync('eas', ['update', '--channel', channel, '--environment', channel, '--platform', platform, ...args], {
    stdio: 'inherit',
  });
  if (status !== 0) process.exit(status ?? 1);
}
