const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');
const config = getDefaultConfig(__dirname);
const packagesRoot = path.resolve(__dirname, '../../packages') + path.sep;
// Shared Node/browser packages use ESM .js specifiers for TypeScript source.
// Metro doesn't apply TypeScript's extension substitution automatically.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (context.originModulePath.startsWith(packagesRoot) && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const source = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return { type: 'sourceFile', filePath: source };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
