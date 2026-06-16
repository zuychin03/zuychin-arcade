import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ScalePressable } from '../ui/ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';

interface Props {
  roomCode: string;
  hasPassword: boolean;
}

export function RoomCodeDisplay({ roomCode, hasPassword }: Props) {
  return (
    <View
      className="items-center rounded-2xl border border-arcade-border bg-arcade-surface p-5"
      style={{ boxShadow: `0 0 16px ${ARCADE.cyan}33` }}
    >
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 11, letterSpacing: 2, color: ARCADE.muted }}>ROOM CODE</Text>
      <Text style={{ fontSize: 38, fontFamily: 'Outfit_800ExtraBold', letterSpacing: 6, marginVertical: 4, ...neonText(ARCADE.cyan, 16) }}>
        {roomCode}
      </Text>
      {hasPassword && <Text className="text-xs text-arcade-muted">🔒 password protected</Text>}
      <View className="mt-4 flex-row gap-3">
        <ScalePressable
          onPress={() => void Clipboard.setStringAsync(roomCode)}
          style={{
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: ARCADE.purple,
            paddingHorizontal: 18,
            paddingVertical: 10,
          }}
        >
          <Text style={{ color: ARCADE.purple, fontFamily: 'Outfit_700Bold', fontSize: 13 }}>Copy</Text>
        </ScalePressable>
        <ScalePressable
          onPress={() =>
            void Share.share({ message: `Join my Saboteur game on zuychin-arcade! Room code: ${roomCode}` })
          }
          style={{
            borderRadius: 12,
            backgroundColor: ARCADE.cyan,
            paddingHorizontal: 18,
            paddingVertical: 10,
            boxShadow: `0 0 10px ${ARCADE.cyan}66`,
          }}
        >
          <Text style={{ color: ARCADE.bg, fontFamily: 'Outfit_700Bold', fontSize: 13 }}>Share</Text>
        </ScalePressable>
      </View>
    </View>
  );
}
