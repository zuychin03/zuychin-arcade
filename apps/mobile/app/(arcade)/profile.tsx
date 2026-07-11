import { useEffect, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { loadDisplayName, saveDisplayName } from '../../lib/storage';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE, neonText } from '../../constants/theme';

export default function ProfileScreen() {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadDisplayName().then((n) => n && setName(n));
  }, []);

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await saveDisplayName(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <View className="flex-1 bg-arcade-bg px-6 pt-16">
      <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', letterSpacing: 4, ...neonText(ARCADE.purple, 12) }}>
        PICK A NAME
      </Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', fontSize: 12, marginTop: 4, marginBottom: 32 }}>
        your name follows you into every game
      </Text>

      <Animated.View entering={FadeInUp.springify().damping(16)}>
        <Text className="mb-2 text-xs font-bold tracking-widest text-arcade-muted">DISPLAY NAME</Text>
        <TextInput
          className="rounded-2xl border border-arcade-border bg-arcade-surface px-5 py-4 text-lg font-bold text-arcade-text"
          placeholder="e.g. Danny"
          placeholderTextColor={ARCADE.muted}
          maxLength={20}
          value={name}
          onChangeText={setName}
          style={{ letterSpacing: 1 }}
        />
        <View className="mt-4">
          <NeonButton
            label={saved ? 'SAVED' : 'SAVE NAME'}
            icon={saved ? <MaterialCommunityIcons name="check" size={16} color={ARCADE.bg} /> : undefined}
            color={saved ? ARCADE.cyan : ARCADE.purple}
            onPress={() => void onSave()}
          />
        </View>
      </Animated.View>


    </View>
  );
}
