import { useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSocket } from '../../hooks/useSocket';
import { clearAuthIfMatches } from '../../lib/storage';
import { useGameStore } from '../../store/useGameStore';
import { NeonButton } from './NeonButton';

interface Props {
  message: string;
  background: string;
  surface: string;
  border: string;
  accent: string;
  muted: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onSessionCleared?: () => void;
}

export function GameRecovery({ message, background, surface, border, accent, muted, icon = 'connection', onSessionCleared }: Props) {
  const token = useGameStore((state) => state.token);
  const mountedRef = useRef(true);
  const lifecycleIdentity = useRef(token);
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useLayoutEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || token === previous) return;
    leavingRef.current = false;
    setLeaving(false);
    setCleanupError(null);
  }, [token]);

  const ownsSession = () => mountedRef.current && useGameStore.getState().token === token;

  const backToArcade = async () => {
    if (leavingRef.current || !ownsSession()) return;
    leavingRef.current = true;
    setLeaving(true);
    setCleanupError(null);
    getSocket()?.disconnect();
    try {
      if (token) await clearAuthIfMatches(token);
    } catch {
      if (!ownsSession()) return;
      leavingRef.current = false;
      setLeaving(false);
      setCleanupError('Your saved session could not be cleared. Try Back to Arcade again.');
      return;
    }
    if (!ownsSession()) return;
    useGameStore.getState().clearAll();
    if (onSessionCleared) onSessionCleared();
    else router.replace('/');
  };

  const retryConnection = () => {
    if (leavingRef.current || !ownsSession()) return;
    const socket = getSocket();
    if (!socket) return;
    if (!socket.connected) socket.connect();
    else socket.emit('request_state');
  };

  return (
    <View style={{ flex: 1, backgroundColor: background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 420, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 20, gap: 14, alignItems: 'center' }}>
        <MaterialCommunityIcons name={icon} size={42} color={accent} />
        <View style={{ alignItems: 'center', gap: 5 }}>
          <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: accent, fontSize: 17, textAlign: 'center' }}>RESTORING GAME</Text>
          <Text accessibilityLiveRegion="polite" style={{ fontFamily: 'SpaceMono_400Regular', color: muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{message}</Text>
        </View>
        {cleanupError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ fontFamily: 'SpaceMono_700Bold', color: accent, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>{cleanupError}</Text> : null}
        <View style={{ width: '100%', gap: 8 }}>
          <NeonButton label="RETRY CONNECTION" color={accent} disabled={leaving} onPress={retryConnection} />
          <NeonButton label={leaving ? 'LEAVING…' : 'BACK TO ARCADE'} color={muted} variant="outline" disabled={leaving} onPress={() => { void backToArcade(); }} />
        </View>
      </View>
    </View>
  );
}
