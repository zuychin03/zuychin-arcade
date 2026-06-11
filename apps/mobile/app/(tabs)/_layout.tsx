import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { ARCADE } from '../../constants/theme';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: ARCADE.surface,
          borderTopColor: ARCADE.border,
          borderTopWidth: 1,
          height: 62,
          paddingTop: 6,
        },
        tabBarActiveTintColor: ARCADE.cyan,
        tabBarInactiveTintColor: ARCADE.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
        sceneStyle: { backgroundColor: ARCADE.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Arcade',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🕹️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Ranks',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏆" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👾" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
