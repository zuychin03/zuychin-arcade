import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

let currentPreference: boolean | null = null;
let nativeSubscription: ReturnType<typeof AccessibilityInfo.addEventListener> | null = null;
const listeners = new Set<() => void>();

function updatePreference(enabled: boolean) {
  if (currentPreference === enabled) return;
  currentPreference = enabled;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!nativeSubscription) {
    nativeSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', updatePreference);
    void AccessibilityInfo.isReduceMotionEnabled().then(updatePreference).catch(() => undefined);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      nativeSubscription?.remove();
      nativeSubscription = null;
    }
  };
}

function getSnapshot() {
  return currentPreference;
}

export function useReducedMotionPreference(): boolean {
  const startupPreference = useReducedMotion();
  const livePreference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return livePreference ?? startupPreference;
}
