import { useEffect, useRef, useState } from 'react';
import { Share, Text, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScalePressable } from '../ui/ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';

export interface RoomCodePalette {
  background: string;
  surface: string;
  border: string;
  accent: string;
  secondary: string;
  muted: string;
  text: string;
}

interface Props {
  roomCode: string;
  hasPassword: boolean;
  gameName?: string;
  palette?: RoomCodePalette;
}

const DEFAULT_PALETTE: RoomCodePalette = {
  background: ARCADE.bg,
  surface: ARCADE.surface,
  border: ARCADE.border,
  accent: ARCADE.cyan,
  secondary: ARCADE.purple,
  muted: ARCADE.muted,
  text: ARCADE.text,
};

export function RoomCodeDisplay({
  roomCode,
  hasPassword,
  gameName = 'Zuychin Arcade',
  palette = DEFAULT_PALETTE,
}: Props) {
  const { width } = useWindowDimensions();
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeFontSize = width <= 340 ? 28 : width <= 420 ? 32 : 38;
  const codeLetterSpacing = width <= 340 ? 3 : width <= 420 ? 4 : 6;

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const showFeedback = (message: string) => {
    setFeedback(message);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2500);
  };

  const copyCode = async () => {
    try {
      await Clipboard.setStringAsync(roomCode);
      showFeedback('Room code copied.');
    } catch {
      showFeedback('Could not copy. Select the code above instead.');
    }
  };

  const shareCode = async () => {
    try {
      const result = await Share.share({ message: `Join my ${gameName} game on Zuychin Arcade! Room code: ${roomCode}` });
      if (result.action === Share.sharedAction) showFeedback('Share sheet opened.');
    } catch {
      showFeedback('Sharing is unavailable. Copy the room code instead.');
    }
  };

  return (
    <View
      style={{
        alignItems: 'center',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        padding: 20,
        width: '100%',
        boxShadow: `0 0 16px ${palette.accent}33`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <MaterialCommunityIcons name="access-point" size={13} color={palette.accent} />
        <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 11, letterSpacing: 2, color: palette.muted }}>
          ROOM CODE
        </Text>
      </View>
      <Text
        selectable
        accessibilityLabel={`Room code ${roomCode}`}
        style={{
          fontSize: codeFontSize,
          fontFamily: 'Outfit_800ExtraBold',
          letterSpacing: codeLetterSpacing,
          marginVertical: 4,
          maxWidth: '100%',
          textAlign: 'center',
          ...neonText(palette.accent, 16),
        }}
      >
        {roomCode}
      </Text>
      {hasPassword ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MaterialCommunityIcons name="lock-outline" size={13} color={palette.muted} />
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: palette.muted, fontSize: 11 }}>
            password protected
          </Text>
        </View>
      ) : (
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: palette.muted, fontSize: 11 }}>
          Share this code with your players
        </Text>
      )}

      <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        <ScalePressable
          accessibilityLabel={feedback === 'Room code copied.' ? 'Room code copied' : 'Copy room code'}
          onPress={() => void copyCode()}
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: palette.secondary,
            paddingHorizontal: 16,
            paddingVertical: 9,
          }}
        >
          <MaterialCommunityIcons name="content-copy" size={14} color={palette.secondary} />
          <Text style={{ color: palette.secondary, fontFamily: 'Outfit_700Bold', fontSize: 12 }}>COPY</Text>
        </ScalePressable>
        <ScalePressable
          accessibilityLabel="Share room code"
          onPress={() => void shareCode()}
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 12,
            backgroundColor: palette.accent,
            paddingHorizontal: 16,
            paddingVertical: 9,
            boxShadow: `0 0 10px ${palette.accent}66`,
          }}
        >
          <MaterialCommunityIcons name="share-variant-outline" size={14} color={palette.background} />
          <Text style={{ color: palette.background, fontFamily: 'Outfit_700Bold', fontSize: 12 }}>SHARE</Text>
        </ScalePressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ minHeight: 18, marginTop: 7, fontFamily: 'SpaceMono_700Bold', color: feedback?.startsWith('Could') || feedback?.startsWith('Sharing') ? '#FF6B7D' : palette.secondary, fontSize: 10, textAlign: 'center' }}>
        {feedback ?? ''}
      </Text>
    </View>
  );
}
