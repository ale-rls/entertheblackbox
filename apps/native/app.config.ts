import type { ExpoConfig } from 'expo/config';
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const config: ExpoConfig = {
  name: 'Enter the Blackbox', slug: 'enter-the-blackbox', scheme: 'entertheblackbox',
  version: '1.0.0', orientation: 'portrait',
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  runtimeVersion: { policy: 'fingerprint' },
  // Shows never reload themselves mid-performance. Updates are requested explicitly while disconnected.
  updates: { checkAutomatically: 'NEVER', fallbackToCacheTimeout: 0,
    ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : { enabled: false }) },
  extra: { ...(projectId ? { eas: { projectId } } : {}) },
  ios: {
    bundleIdentifier: process.env.APP_BUNDLE_ID ?? 'org.entertheblackbox.player',
    supportsTablet: true,
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
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
  },
  plugins: [
    ['expo-audio', { enableBackgroundPlayback: true, enableBackgroundRecording: false,
      microphonePermission: false, recordAudioAndroid: false }],
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-build-properties', { android: { usesCleartextTraffic: process.env.ALLOW_INSECURE_LAN === '1' } }],
  ],
};
export default config;
