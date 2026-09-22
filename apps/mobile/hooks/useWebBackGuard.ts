import { useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { registerWebBackGuard } from '../lib/webBackGuardDispatcher';

const WEB_BACK_GUARD_KEY = '__zuychinArcadeBackGuard';
export const WEB_BACK_GUARD_READY_KEY = '__zuychinArcadeBackGuardReady';

type GuardWindow = Window & {
  [WEB_BACK_GUARD_READY_KEY]?: string;
};

function objectState(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function useWebBackGuard(pathname: string, onBack: () => void, enabled = true): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !enabled) return;

    const browserWindow = window as GuardWindow;
    const guardedHref = new URL(pathname, browserWindow.location.origin).href;
    let guardedState = objectState(browserWindow.history.state);
    let frame: number;

    const handlePopState = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      browserWindow.history.pushState(
        { ...guardedState, [WEB_BACK_GUARD_KEY]: guardedHref },
        '',
        guardedHref,
      );
      browserWindow[WEB_BACK_GUARD_READY_KEY] = guardedHref;
      onBackRef.current();
    };

    const unregister = registerWebBackGuard(handlePopState);
    // Let Expo commit the route's own history id before adding its protected duplicate.
    const arm = () => {
      if (browserWindow.location.pathname !== new URL(guardedHref).pathname) {
        frame = browserWindow.requestAnimationFrame(arm);
        return;
      }
      guardedState = objectState(browserWindow.history.state);
      if (guardedState[WEB_BACK_GUARD_KEY] !== guardedHref) {
        browserWindow.history.pushState(
          { ...guardedState, [WEB_BACK_GUARD_KEY]: guardedHref }, '', guardedHref,
        );
      }
      browserWindow[WEB_BACK_GUARD_READY_KEY] = guardedHref;
    };
    frame = browserWindow.requestAnimationFrame(arm);

    return () => {
      browserWindow.cancelAnimationFrame(frame);
      if (unregister() && browserWindow[WEB_BACK_GUARD_READY_KEY] === guardedHref) {
        delete browserWindow[WEB_BACK_GUARD_READY_KEY];
      }
    };
  }, [enabled, pathname]);
}
