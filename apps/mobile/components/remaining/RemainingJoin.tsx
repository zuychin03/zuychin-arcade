import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { JoinRoomResponse } from '@zuychin-arcade/types';
import { joinRoom, leaveRoom } from '../../lib/api';
import { gameLobbyRoute } from '../../lib/gameRoutes';
import { formatRoomCodeInput, ROOM_CODE_EXAMPLE, ROOM_CODE_PATTERN } from '../../lib/roomCode';
import { clearAuthIfMatches, loadDisplayName, saveAuthIfCurrent, saveDisplayName } from '../../lib/storage';
import { useGameStore } from '../../store/useGameStore';
import { NeonButton } from '../ui/NeonButton';
import { TYPOGRAPHY } from '../../constants/typography';

interface Props {
  title: string;
  mark: ReactNode;
  palette: { bg: string; surface: string; border: string; accent: string; secondary: string; muted: string; text: string; onAccent?: string };
}

export function RemainingJoin({ title, mark, palette }: Props) {
  const compact = useWindowDimensions().width < 560;
  const keyboardInsets = Platform.OS === 'ios'
    ? { automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: 'interactive' as const }
    : {};
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const active = useRef(true);
  const nameEdited = useRef(false);
  const nameInput = useRef<TextInput>(null);
  const codeInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);

  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []));

  useEffect(() => {
    mounted.current = true;
    void loadDisplayName().then((value) => {
      if (mounted.current && !nameEdited.current && value) setName(value);
    }).catch(() => undefined);
    return () => { mounted.current = false; };
  }, []);

  const join = async () => {
    if (busyRef.current) return;
    const displayName = name.trim();
    const roomCode = code.trim().toUpperCase();
    if (!displayName) {
      setError('Enter the name other players will see.');
      nameInput.current?.focus();
      return;
    }
    if (!ROOM_CODE_PATTERN.test(roomCode)) {
      setError('Enter a valid room code, such as ' + ROOM_CODE_EXAMPLE + '.');
      codeInput.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let response: JoinRoomResponse | undefined;
    let adopted = false;
    try {
      response = await joinRoom(roomCode, displayName, password || undefined);
      if (!mounted.current || !active.current) return;
      const auth = { token: response.token, playerId: response.playerId, roomCode: response.roomCode, displayName };
      const saved = await saveAuthIfCurrent(auth, () => mounted.current && active.current);
      if (!saved || !mounted.current || !active.current) {
        await clearAuthIfMatches(auth.token);
        return;
      }
      adopted = true;
      void saveDisplayName(displayName).catch(() => undefined);
      useGameStore.getState().setAuth(auth);
      useGameStore.getState().setRoom(response.room);
      if (mounted.current) router.replace(gameLobbyRoute(response.room.gameId) as never);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'The room could not be joined. Please try again.');
    } finally {
      if (response && !adopted) void leaveRoom(response.roomCode, response.token).catch(() => undefined);
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const input = {
    minHeight: 48, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1,
    ...TYPOGRAPHY.body, borderRadius: 16, color: palette.text, padding: 16,
  } as const;
  const label = { ...TYPOGRAPHY.label, color: palette.muted } as const;

  return (
    <ScrollView {...keyboardInsets} keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ width: '100%', maxWidth: 620, alignSelf: 'center', padding: compact ? 18 : 28, paddingBottom: 44, gap: 12 }}>
      <View style={{ alignItems: 'center', marginBottom: 4 }}>
        {mark}
        <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.display, color: palette.accent, fontSize: 24, lineHeight: 32, marginTop: 8, textAlign: 'center' }}>{title}</Text>
        <Text style={{ ...TYPOGRAPHY.body, color: palette.muted, textAlign: 'center', marginTop: 8 }}>Ask the host for the room code. You can join any game with its code.</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ ...TYPOGRAPHY.body, color: palette.text }}>{error}</Text> : null}
      <Text style={label}>YOUR NAME</Text>
      <TextInput ref={nameInput} accessibilityLabel="Your name" autoComplete="nickname" value={name} editable={!busy} onChangeText={(value) => { nameEdited.current = true; setName(value); setError(null); }} maxLength={20} placeholder="Player name" placeholderTextColor={palette.muted} style={input} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => codeInput.current?.focus()} />
      <Text style={label}>ROOM CODE</Text>
      <TextInput ref={codeInput} accessibilityLabel="Room code" accessibilityHint={'Use eight letters or numbers, for example ' + ROOM_CODE_EXAMPLE} value={code} editable={!busy} onChangeText={(value) => { setCode(formatRoomCodeInput(value)); setError(null); }} placeholder={ROOM_CODE_EXAMPLE} placeholderTextColor={palette.muted} autoCapitalize="characters" autoCorrect={false} maxLength={9} style={{ ...input, ...TYPOGRAPHY.data, borderColor: palette.accent, borderWidth: 2, color: palette.secondary, fontSize: compact ? 24 : 27, lineHeight: 36, letterSpacing: 3, textAlign: 'center' }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => passwordInput.current?.focus()} />
      <Text style={label}>ROOM PASSWORD · OPTIONAL</Text>
      <TextInput ref={passwordInput} accessibilityLabel="Room password, optional" autoComplete="current-password" value={password} editable={!busy} onChangeText={(value) => { setPassword(value); setError(null); }} secureTextEntry maxLength={64} placeholder="Leave blank for an open room" placeholderTextColor={palette.muted} style={input} returnKeyType="go" onSubmitEditing={() => void join()} />
      <NeonButton label={busy ? 'JOINING…' : 'JOIN GAME'} color={palette.accent} solidTextColor={palette.onAccent} disabled={busy} onPress={() => void join()} />
    </ScrollView>
  );
}
