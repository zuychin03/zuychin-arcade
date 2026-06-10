import { Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

interface Props {
  roomCode: string;
  hasPassword: boolean;
}

export function RoomCodeDisplay({ roomCode, hasPassword }: Props) {
  return (
    <View className="items-center rounded-xl bg-mine-surface p-4">
      <Text className="text-sm text-mine-stone">Room code</Text>
      <Text className="my-1 text-4xl font-bold tracking-widest text-mine-gold">{roomCode}</Text>
      {hasPassword && <Text className="text-xs text-mine-stone">🔒 password protected</Text>}
      <View className="mt-3 flex-row gap-3">
        <Pressable
          className="rounded-lg bg-mine-tunnel px-4 py-2"
          onPress={() => void Clipboard.setStringAsync(roomCode)}
        >
          <Text className="font-semibold text-white">Copy code</Text>
        </Pressable>
        <Pressable
          className="rounded-lg bg-mine-gold px-4 py-2"
          onPress={() =>
            void Share.share({ message: `Join my Saboteur game on zuychin-arcade! Room code: ${roomCode}` })
          }
        >
          <Text className="font-semibold text-mine-bg">Share</Text>
        </Pressable>
      </View>
    </View>
  );
}
