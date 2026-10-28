import type { ExpoConfig } from 'expo/config';
// eas-cli resolves the project before it pulls EAS environment variables, and does not read .env.local.
// These identifiers are public, so the show's EAS project is the fallback; env vars still override.
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? 'b9d7bb05-42d6-4711-9b1e-2cdfb6c21ef1';
// Set only by the production EAS profile. Gated so store-only config never changes the
// update fingerprint of installed preview/development builds.
const store = process.env.STORE_BUILD === '1';
const config: ExpoConfig = {
  name: 'Enter the Blackbox', slug: 'enter-the-blackbox', scheme: 'entertheblackbox',
  version: '1.0.0', orientation: 'portrait',
  owner: process.env.EXPO_OWNER ?? 'manusnijhoff',
  runtimeVersion: { policy: 'fingerprint' },
  // Shows never reload themselves mid-performance. Updates are requested explicitly while disconnected.
  updates: { checkAutomatically: 'NEVER', fallbackToCacheTimeout: 0, url: `https://u.expo.dev/${projectId}` },
  extra: { eas: { projectId } },
  ios: {
    bundleIdentifier: process.env.APP_BUNDLE_ID ?? 'org.entertheblackbox.player',
    // Store builds are phone-only: no iPad review device or iPad screenshots.
    supportsTablet: !store,
    infoPlist: {
      NSLocalNetworkUsageDescription: 'Connect to the venue show server to receive playback cues and send your choices.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true, ...(process.env.ALLOW_INSECURE_LAN === '1' ? { NSAllowsArbitraryLoads: true } : {}) },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: process.env.APP_BUNDLE_ID ?? 'org.entertheblackbox.player',
    // Only internal rehearsal binaries permit HTTP LAN endpoints. Store builds use HTTPS/WSS.
    permissions: ['INTERNET'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE',
      // React Native's template requests overlay permission for the dev menu; Play treats it as a special permission.
      ...(store ? ['android.permission.SYSTEM_ALERT_WINDOW'] : [])],
  },
  plugins: [
    'expo-notifications',
    // Native clock-scheduled playback: iOS background audio, Android media foreground service.
    '@entertheblackbox/expo-audio-scheduler',
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-build-properties', { android: { usesCleartextTraffic: process.env.ALLOW_INSECURE_LAN === '1' } }],
  ],
};
export default config;
