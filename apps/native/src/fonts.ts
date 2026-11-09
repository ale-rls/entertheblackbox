import { useSyncExternalStore } from 'react';
import * as Font from 'expo-font';
import { OPTIK_FAMILIES } from './typography';

// Optik is licensed and gitignored (fonts/README.md). Metro treats requires inside
// try as optional, so a checkout without the files still bundles and the app keeps
// the system font.
let sources: Record<string, number> | null = null;
try {
  sources = {
    [OPTIK_FAMILIES.regular]: require('../../../fonts/optik/Optik-Regular.ttf'),
    [OPTIK_FAMILIES.bold]: require('../../../fonts/optik/Optik-Bold.ttf'),
    [OPTIK_FAMILIES.italic]: require('../../../fonts/optik/Optik-Italic.ttf'),
  };
} catch {
  sources = null;
}

let loaded = false;
const listeners = new Set<() => void>();

/** Registers Optik once; text renders in the system font until it resolves, and keeps it if loading fails. */
export function loadOptik(): void {
  if (!sources || loaded) return;
  Font.loadAsync(sources).then(() => {
    loaded = true;
    listeners.forEach(listener => listener());
  }, () => {});
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useOptikLoaded = () => useSyncExternalStore(subscribe, () => loaded);
