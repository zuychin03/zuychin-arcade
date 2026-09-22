type BackGuard = (event: PopStateEvent) => void;
type GuardRegistry = { active: BackGuard | null };
const REGISTRY_KEY = '__zuychinArcadeBackDispatcher';
type GuardWindow = Window & { [REGISTRY_KEY]?: GuardRegistry };

function registry(): GuardRegistry | null {
  if (typeof window === 'undefined' || !window.history || !window.addEventListener) return null;
  const browser = window as GuardWindow;
  if (!browser[REGISTRY_KEY]) {
    const value: GuardRegistry = { active: null };
    browser[REGISTRY_KEY] = value;
    // Window popstate listeners run in registration order, including capture listeners.
    browser.addEventListener('popstate', (event) => value.active?.(event), true);
  }
  return browser[REGISTRY_KEY];
}

registry();

export function registerWebBackGuard(guard: BackGuard): () => boolean {
  const value = registry();
  if (value) value.active = guard;
  return () => {
    if (!value || value.active !== guard) return false;
    value.active = null;
    return true;
  };
}
