import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ARCADE } from '../../constants/theme';
import { useGameStore } from '../../store/useGameStore';

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
  const [ios, setIos] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const lock = useRef<UpdateLock | null>(null);
  const requestUpdate = useRef<() => void>(() => undefined);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const updateInstalled = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    updateInstalled();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    standalone.addEventListener('change', updateInstalled);
    const onInstallPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); setInstructions(false); };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      standalone.removeEventListener('change', updateInstalled);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
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
      if (choice.outcome === 'accepted') setInstalled(true);
      setInstallPrompt(null);
    } catch {
      setInstallPrompt(null);
      setInstructions(true);
    }
  };

  if (pathname !== '/' || hasSession || (installed && !waiting && !message)) return null;
  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, {
      paddingBottom: Math.max(12, insets.bottom), paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right),
    }]} testID="pwa-controls">
      <View style={styles.row}>
        {!installed ? <Pressable accessibilityRole="button" onPress={() => void install()} style={styles.button}>
          <Text style={styles.buttonText}>{installPrompt ? 'Install Arcade' : 'Add Arcade to your device'}</Text>
        </Pressable> : null}
        {waiting ? <Pressable accessibilityRole="button" disabled={updating} onPress={() => requestUpdate.current()} style={styles.button}>
          <Text style={styles.buttonText}>{updating ? 'Updating…' : 'Update Arcade'}</Text>
        </Pressable> : null}
      </View>
      {instructions ? <Text style={styles.copy}>{ios
        ? 'Open your browser’s Share menu, choose Add to Home Screen, then Add. If it is missing, open this page in Safari.'
        : 'Open your browser’s menu and choose Install app or Add to Home screen. If neither appears, this browser may not support installation. You can still play here.'}</Text> : null}
      {message || updating ? <Text style={styles.copy} accessibilityLiveRegion="polite">{updating ? 'Applying the update. Your library will reopen shortly.' : message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 0, flexShrink: 0, maxHeight: '40%', backgroundColor: ARCADE.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 48, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: ARCADE.panel },
  buttonText: { fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 22, color: ARCADE.cyan, flexShrink: 1 },
  copy: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: ARCADE.text, maxWidth: 680 },
});
