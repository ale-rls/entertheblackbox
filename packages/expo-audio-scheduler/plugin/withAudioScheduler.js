// Config plugin: background audio on iOS, foreground media playback on Android.
// The Android service itself is declared in the library manifest and merged at build time.
const { AndroidConfig, createRunOncePlugin, withInfoPlist } = require('expo/config-plugins');
const pkg = require('../package.json');

const withAudioScheduler = (config) => {
  config = withInfoPlist(config, (config) => {
    const modes = Array.isArray(config.modResults.UIBackgroundModes) ? config.modResults.UIBackgroundModes : [];
    if (!modes.includes('audio')) modes.push('audio');
    config.modResults.UIBackgroundModes = modes;
    return config;
  });
  return AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.WAKE_LOCK',
  ]);
};

module.exports = createRunOncePlugin(withAudioScheduler, pkg.name, pkg.version);
