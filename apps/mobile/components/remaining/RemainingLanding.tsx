import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Platform, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GameId, JoinRoomResponse } from '@zuychin-arcade/types';
import { createRoom, leaveRoom } from '../../lib/api';
import { clearAuthIfMatches, loadDisplayName, saveAuthIfCurrent, saveDisplayName } from '../../lib/storage';
import { useGameStore } from '../../store/useGameStore';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { NeonButton } from '../ui/NeonButton';
import { ScalePressable } from '../ui/ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';

type Palette = { bg: string; surface: string; panel: string; border: string; accent: string; secondary: string; muted: string; text: string };
interface Props {
  gameId: GameId;
  base: string;
  title: string;
  tagline: string;
  tags: string[];
  createLabel: string;
  mark: ReactNode;
  hero: ReactNode;
  renderRules: (visible: boolean, onClose: () => void) => ReactNode;
  palette: Palette;
  presentation?: 'classic' | 'illustrated';
}

function IllustratedButton({ label, onPress, color = ARCADE.pink, variant = 'solid', disabled, icon }: ComponentProps<typeof NeonButton>) {
  const solid = variant === 'solid';
  return (
    <ScalePressable onPress={onPress} disabled={disabled} accessibilityLabel={label} style={{ minHeight: 48, minWidth: 0, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: variant === 'outline' ? 1 : 0, borderColor: color, backgroundColor: solid ? color : 'transparent', opacity: disabled ? 0.4 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {icon}
        <Text style={{ flexShrink: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', fontSize: 16, color: solid ? ARCADE.bg : color, textAlign: 'center' }}>{label}</Text>
      </View>
    </ScalePressable>
  );
}

export function RemainingLanding({ gameId, base, title, tagline, tags, createLabel, mark, hero, renderRules, palette, presentation = 'classic' }: Props) {
  const { width, height, fontScale = 1 } = useWindowDimensions();
  const compact = width < 560;
  const illustrated = presentation === 'illustrated';
  const [contentWidth, setContentWidth] = useState(0);
  const [webTextScale, setWebTextScale] = useState(1);
  const titleRef = useRef<Text>(null);
  const titleSize = width < 360 ? 24 : compact ? 28 : 36;
  const shortLandscape = width > height && height < 500;
  const sideBySide = illustrated && contentWidth >= 720 * Math.max(1, fontScale, webTextScale);
  const compactIntroduction = shortLandscape && !sideBySide;
  const artMaxWidth = shortLandscape ? Math.max(180, Math.min(280, height * 0.6)) : undefined;
  const ActionButton = illustrated ? IllustratedButton : NeonButton;
  const keyboardInsets = Platform.OS === 'ios'
    ? { automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: 'interactive' as const }
    : {};
  const reduceMotion = useReducedMotionPreference();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const active = useRef(true);
  const nameEdited = useRef(false);
  const nameInput = useRef<TextInput>(null);
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

  const create = async () => {
    if (busyRef.current) return;
    const displayName = name.trim();
    if (!displayName) {
      setError('Enter the name other players will see.');
      nameInput.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let response: JoinRoomResponse | undefined;
    let adopted = false;
    try {
      response = await createRoom(displayName, password || undefined, gameId);
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
      if (mounted.current) router.push((base + '/lobby') as never);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'The room could not be created. Please try again.');
    } finally {
      if (response && !adopted) void leaveRoom(response.roomCode, response.token).catch(() => undefined);
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const input = {
    minHeight: 48, borderRadius: illustrated ? 12 : 15, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.bg, color: palette.text, fontFamily: illustrated ? 'Outfit_400Regular' : 'Outfit_700Bold', fontSize: 16, padding: 15,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView {...keyboardInsets} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: compact ? 14 : 24, paddingBottom: 44 }}>
        <View onLayout={illustrated ? (event) => setContentWidth(event.nativeEvent.layout.width) : undefined} style={{ width: '100%', maxWidth: illustrated ? 1120 : 720, alignSelf: 'center', gap: illustrated ? 24 : 14, flexDirection: sideBySide ? 'row' : 'column', alignItems: sideBySide ? 'flex-start' : 'stretch' }}>
          {illustrated ? <View style={{ minWidth: 0, flex: sideBySide ? 1 : undefined, flexDirection: compactIntroduction ? 'row' : 'column', alignItems: 'flex-start', gap: 16 }}>
            <View style={{ width: compactIntroduction ? '30%' : '100%', maxWidth: artMaxWidth, flexShrink: 0, borderRadius: 16, overflow: 'hidden' }}>{hero}</View>
            <View style={{ minWidth: 0, flex: compactIntroduction ? 1 : undefined, alignSelf: 'stretch', gap: 8 }}>
              <Text ref={titleRef} onLayout={() => {
                if (Platform.OS !== 'web' || typeof window === 'undefined' || !titleRef.current) return;
                const scale = Number.parseFloat(window.getComputedStyle(titleRef.current as unknown as Element).fontSize) / titleSize;
                if (Number.isFinite(scale)) setWebTextScale(Math.max(1, scale));
              }} accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: titleSize, color: palette.text, flexShrink: 1 }}>{title}</Text>
              <Text style={{ fontFamily: 'Outfit_400Regular', color: palette.muted, fontSize: 16, lineHeight: 24 }}>{tagline}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                {tags.map((tag) => <Text key={tag} style={{ fontFamily: 'Outfit_400Regular', color: palette.accent, fontSize: 14 }}>{tag}</Text>)}
              </View>
            </View>
          </View> : <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(460)} style={{ overflow: 'hidden', borderRadius: 24, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, boxShadow: '0 0 22px ' + palette.accent + '29' }}>
            {hero}
            <View style={{ alignItems: 'center', padding: 18, paddingTop: 29 }}>
              <View style={{ position: 'absolute', top: -35, borderRadius: 40, backgroundColor: palette.bg }}>{mark}</View>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: compact ? 29 : 34, letterSpacing: 4, textAlign: 'center', ...neonText(palette.accent, 15) }}>{title}</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: palette.muted, textAlign: 'center', fontSize: 12, lineHeight: 19, marginTop: 7, maxWidth: 560 }}>{tagline}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7, marginTop: 13 }}>
                {tags.map((tag) => <View key={tag} style={{ borderRadius: 99, borderWidth: 1, borderColor: palette.accent + '66', backgroundColor: palette.accent + '12', paddingHorizontal: 9, paddingVertical: 6 }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: palette.accent, fontSize: 10 }}>{tag}</Text>
                </View>)}
              </View>
            </View>
          </Animated.View>}
          <Animated.View entering={reduceMotion || illustrated ? undefined : FadeInUp.delay(100).springify().damping(17)} style={{ minWidth: 0, width: sideBySide ? '40%' : undefined, borderRadius: illustrated ? 16 : 20, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, padding: compact ? 16 : 20, gap: illustrated ? 16 : 13 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {illustrated ? null : mark}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: palette.text, fontSize: illustrated ? 20 : 15 }}>{createLabel}</Text>
                <Text style={{ fontFamily: illustrated ? 'Outfit_400Regular' : 'SpaceMono_400Regular', color: palette.muted, fontSize: illustrated ? 16 : 12, lineHeight: illustrated ? 24 : 18 }}>Create a table or join by room code</Text>
              </View>
            </View>
            {error ? <Text accessibilityRole="alert" style={{ color: palette.text, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
            <Text style={{ fontFamily: 'Outfit_700Bold', color: palette.accent, fontSize: 12, letterSpacing: 1 }}>YOUR NAME</Text>
            <TextInput ref={nameInput} accessibilityLabel="Your name" autoComplete="nickname" value={name} editable={!busy} onChangeText={(value) => { nameEdited.current = true; setName(value); setError(null); }} maxLength={20} placeholder="Player name" placeholderTextColor={palette.muted} style={input} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => passwordInput.current?.focus()} />
            <Text style={{ fontFamily: 'Outfit_700Bold', color: palette.accent, fontSize: 12, letterSpacing: 1 }}>ROOM PASSWORD · OPTIONAL</Text>
            <TextInput ref={passwordInput} accessibilityLabel="Room password, optional" autoComplete="new-password" value={password} editable={!busy} onChangeText={(value) => { setPassword(value); setError(null); }} secureTextEntry maxLength={64} placeholder="Password" placeholderTextColor={palette.muted} style={input} returnKeyType="go" onSubmitEditing={() => void create()} />
            <Text style={{ fontFamily: 'Outfit_400Regular', color: palette.muted, fontSize: 16, lineHeight: 24 }}>Leave blank for an open room</Text>
            <ActionButton label={busy ? 'CREATING…' : 'CREATE ROOM'} color={palette.accent} disabled={busy} icon={<MaterialCommunityIcons name="plus" size={17} color={palette.bg} />} onPress={() => void create()} />
            <ActionButton label="JOIN WITH CODE" color={palette.secondary} variant="outline" disabled={busy} onPress={() => {
              if (name.trim()) void saveDisplayName(name.trim()).catch(() => undefined);
              router.push((base + '/join') as never);
            }} />
            <ActionButton label="HOW TO PLAY" color={palette.accent} variant="ghost" disabled={busy} onPress={() => setShowRules(true)} />
          </Animated.View>
        </View>
      </ScrollView>
      {renderRules(showRules, () => setShowRules(false))}
    </View>
  );
}
