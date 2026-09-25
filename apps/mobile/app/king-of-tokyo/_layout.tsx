import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { View } from 'react-native';
import { TOKYO } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { RouteBackButton } from '../../components/ui/RouteBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function KingOfTokyoLayout() {
  const reduceMotion = useReducedMotionPreference();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: TOKYO.surface },
        headerTintColor: TOKYO.lime,
        headerTitleStyle: TYPOGRAPHY.navigation,
        contentStyle: { backgroundColor: TOKYO.bg },
        animation: reduceMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'King of Tokyo',
          headerLeft: () => (
            <View style={{ width: 52, height: 48, paddingLeft: 4, justifyContent: 'center', overflow: 'visible' }}>
              <ArcadeBackButton color={TOKYO.lime} />
            </View>
          ),
        }}
      />
      <Stack.Screen
        name="join"
        options={{
          title: 'Join Room',
          headerBackVisible: false,
          headerLeft: () => (
            <View style={{ width: 52, height: 48, paddingLeft: 4, justifyContent: 'center', overflow: 'visible' }}>
              <RouteBackButton
                color={TOKYO.lime}
                href="/king-of-tokyo"
                label="Back to King of Tokyo"
                hint="Return to King of Tokyo room setup"
              />
            </View>
          ),
        }}
      />
      <Stack.Screen
        name="lobby"
        options={{
          title: 'Lobby',
          headerBackVisible: false,
          headerLeft: () => null,
        }}
      />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
