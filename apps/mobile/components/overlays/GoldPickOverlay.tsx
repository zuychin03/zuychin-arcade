import { Pressable, Text, View } from 'react-native';

interface Props {
  availableCards: number[];
  onPick: (value: number) => void;
}

export function GoldPickOverlay({ availableCards, onPick }: Props) {
  return (
    <View className="absolute inset-0 z-50 items-center justify-center bg-black/95 px-6">
      <Text className="text-2xl font-bold text-mine-gold">Pick your gold!</Text>
      <Text className="mb-6 mt-1 text-center text-mine-stone">
        Take one nugget card — the rest pass on to the next miner.
      </Text>
      <View className="flex-row flex-wrap justify-center gap-3">
        {availableCards.map((value, i) => (
          <Pressable
            key={`${value}-${i}`}
            className="h-32 w-24 items-center justify-center rounded-xl border-2 border-mine-gold bg-mine-surface active:bg-mine-tunnel"
            onPress={() => onPick(value)}
          >
            <Text style={{ fontSize: 32 }}>🪙</Text>
            <Text className="mt-2 text-3xl font-extrabold text-mine-gold">{value}</Text>
            <Text className="text-xs text-mine-stone">nugget{value > 1 ? 's' : ''}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
