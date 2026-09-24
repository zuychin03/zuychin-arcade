import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ARCADE } from '../../constants/theme';
import { useGameStore } from '../../store/useGameStore';

const INSTALL_KEY = 'arcade:pwa-installed';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
type UpdateLock = { requestId: string; worker: ServiceWorker; approved: boolean; wasInert: boolean };

export function isUpdateSafe(pathname: string, state: { token: unknown; roomCode: unknown; room: unknown }) {
  return pathname === '/' && !state.token && !state.roomCode && !state.room;
}

export default function PwaControls() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const hasSession = useGameStore(s => Boolean(s.token || s.roomCode || s.room));
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [manualInstall, setManualInstall] = useState(false);
  const [ios, setIos] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const lock = useRef<UpdateLock | null>(null);
  const requestUpdate = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (pathname !== '/' || hasSession) { setSidebarTarget(null); return; }
    const locate = () => setSidebarTarget(document.getElementById('pwa-sidebar-controls'));
    locate();
    // Keep registration mounted while the mobile drawer opens and closes.
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, hasSession]);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const isStandalone = () => standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const rememberInstalled = (value: boolean) => {
      try {
        if (value) window.localStorage.setItem(INSTALL_KEY, '1');
        else window.localStorage.removeItem(INSTALL_KEY);
      } catch { /* Storage can be unavailable in private browsing. */ }
    };
    const onInstalled = () => {
      rememberInstalled(true);
      setInstalled(true); setInstallPrompt(null); setInstructions(false);
    };
    const updateInstalled = () => {
      if (isStandalone()) { onInstalled(); return; }
      try { setInstalled(window.localStorage.getItem(INSTALL_KEY) === '1'); } catch { /* Keep the current installation signal. */ }
    };
    updateInstalled();
    // Chromium only offers installation after confirming the app is installable.
    setManualInstall(!('onbeforeinstallprompt' in window));
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    standalone.addEventListener('change', updateInstalled);
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isStandalone()) return;
      // A fresh browser offer also permits reinstalling after an uninstall.
      rememberInstalled(false);
      setInstalled(false); setInstallPrompt(event as InstallPrompt);
    };
    const onStorage = (event: StorageEvent) => { if (event.key === INSTALL_KEY || event.key === null) updateInstalled(); };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('storage', onStorage);
    return () => {
      standalone.removeEventListener('change', updateInstalled);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (__DEV__ || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detachRegistration = () => {};
    const safe = () => isUpdateSafe(window.location.pathname, useGameStore.getState());
    const release = () => {
      clearTimeout(timer);
      const root = document.getElementById('root');
      if (root && lock.current) root.inert = lock.current.wasInert;
      lock.current = null;
      if (!disposed) setUpdating(false);
    };
    const blockInteraction = (event: Event) => {
      if (!lock.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.requestId !== 'string') return;
      const worker = event.source as ServiceWorker | null;
      if (!worker || (worker !== registration.current?.waiting && worker !== lock.current?.worker)) return;
      if (data.type === 'CHECK_UPDATE_SAFETY') {
        const root = document.getElementById('root');
        if (lock.current || !safe() || !root) {
          worker.postMessage({ type: 'UPDATE_SAFETY', requestId: data.requestId, safe: false });
          return;
        }
        lock.current = { requestId: data.requestId, worker, approved: false, wasInert: root.inert };
        root.inert = true;
        setUpdating(true);
        timer = setTimeout(() => {
          worker.postMessage({ type: 'UPDATE_SAFETY', requestId: data.requestId, safe: false });
          release();
          setMessage('The update could not finish. Close the other Arcade tabs, then try again.');
        }, 15000);
        worker.postMessage({ type: 'UPDATE_SAFETY', requestId: data.requestId, safe: true });
      } else if (data.type === 'UPDATE_BLOCKED') {
        if (lock.current && lock.current.requestId !== data.requestId) return;
        release();
        setMessage('Finish or leave your rooms in every Arcade tab, return to the library, then try again.');
      } else if (data.type === 'UPDATE_APPROVED' && lock.current && lock.current.requestId === data.requestId) {
        lock.current.approved = true;
      }
    };
    const onControllerChange = () => {
      if (lock.current?.approved && safe()) window.location.reload();
      else release();
    };
    const unsubscribe = useGameStore.subscribe(() => {
      if (lock.current && !safe()) {
        lock.current.worker.postMessage({ type: 'UPDATE_SAFETY', requestId: lock.current.requestId, safe: false });
        release();
      }
    });
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    for (const name of ['click', 'pointerdown', 'keydown', 'submit']) document.addEventListener(name, blockInteraction, true);
    navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      registration.current = reg;
      let installing: ServiceWorker | null = null;
      const inspect = () => {
        if (!disposed) setWaiting(Boolean(reg.waiting) || Boolean(installing?.state === 'installed' && navigator.serviceWorker.controller));
      };
      const onUpdateFound = () => {
        installing?.removeEventListener('statechange', inspect);
        installing = reg.installing;
        installing?.addEventListener('statechange', inspect);
        inspect();
      };
      reg.addEventListener('updatefound', onUpdateFound);
      onUpdateFound();
      const checkOnReturn = () => { if (document.visibilityState === 'visible') void reg.update().catch(() => undefined); };
      document.addEventListener('visibilitychange', checkOnReturn);
      detachRegistration = () => {
        installing?.removeEventListener('statechange', inspect);
        reg.removeEventListener('updatefound', onUpdateFound);
        document.removeEventListener('visibilitychange', checkOnReturn);
      };
      requestUpdate.current = () => {
        if (!reg.waiting || !safe() || lock.current) return;
        setMessage('Checking your other Arcade tabs…');
        reg.waiting.postMessage({ type: 'REQUEST_UPDATE', requestId: crypto.randomUUID() });
      };
      void reg.update().catch(() => undefined);
    }).catch(() => {
      if (!disposed) setMessage('Offline recovery is unavailable in this browser. You can still play online.');
    });
    return () => {
      disposed = true;
      release();
      unsubscribe();
      detachRegistration();
      requestUpdate.current = () => undefined;
      navigator.serviceWorker.removeEventListener('message', onMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      for (const name of ['click', 'pointerdown', 'keydown', 'submit']) document.removeEventListener(name, blockInteraction, true);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) { setInstructions(value => !value); return; }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true); setInstructions(false);
        try { window.localStorage.setItem(INSTALL_KEY, '1'); } catch { /* Installation does not require storage. */ }
      }
      setInstallPrompt(null);
    } catch {
      setInstallPrompt(null);
      setManualInstall(true);
      setInstructions(true);
    }
  };

  const showInstall = !installed && (Boolean(installPrompt) || manualInstall);
  if (pathname !== '/' || hasSession || !sidebarTarget || (!showInstall && !waiting && !message)) return null;
  return createPortal(
    <View style={[styles.content, { paddingBottom: Math.max(12, insets.bottom) }]} testID="pwa-controls">
      <View style={styles.row}>
        {showInstall ? <Pressable accessibilityRole="button" onPress={() => void install()} style={styles.button}>
          <Text style={styles.buttonText}>{installPrompt ? 'Install Arcade' : 'Add Arcade to your device'}</Text>
        </Pressable> : null}
        {waiting ? <Pressable accessibilityRole="button" disabled={updating} onPress={() => requestUpdate.current()} style={styles.button}>
          <Text style={styles.buttonText}>{updating ? 'Updating…' : 'Update Arcade'}</Text>
        </Pressable> : null}
      </View>
      {showInstall && instructions ? <Text style={styles.copy}>{ios
        ? 'Open your browser’s Share menu, choose Add to Home Screen, then Add. If it is missing, open this page in Safari.'
        : 'Open your browser’s menu and choose Install app or Add to Home screen. If neither appears, this browser may not support installation. You can still play here.'}</Text> : null}
      {message || updating ? <Text style={styles.copy} accessibilityLiveRegion="polite">{updating ? 'Applying the update. Your library will reopen shortly.' : message}</Text> : null}
    </View>, sidebarTarget,
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', minWidth: 0, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 8 },
  row: { gap: 8 },
  button: { minHeight: 48, width: '100%', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: ARCADE.surface },
  buttonText: { fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 22, color: ARCADE.cyan, flexShrink: 1 },
  copy: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: ARCADE.text, maxWidth: 680 },
});
