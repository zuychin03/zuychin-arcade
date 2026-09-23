import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ARCADE, neonText } from '../../constants/theme';

type SectionProps = {
  title: string;
  children: string;
};

function PrivacySection({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

export default function PrivacyScreen() {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text accessibilityRole="header" style={styles.title}>PRIVACY</Text>
      <Text style={styles.updated}>Updated 23/09/2026</Text>
      <Text style={styles.intro}>How Zuychin Arcade uses your information when you play.</Text>

      <View style={styles.card}>
        <PrivacySection title="Data used to run a game">
          You can play with a nickname. The arcade uses your display name, room code, player identifier, room-session token, lobby choices and game actions to run the table and reconnect your seat. If you create or join a password-protected room, the password is sent to the server. The live room stores a salted password hash, not the readable password.
        </PrivacySection>

        <PrivacySection title="What other players can see">
          Players in your room can see your display name, connection status and the shared game state. Hidden cards, roles and choices are shown or revealed according to that game’s rules. Where rankings are enabled, your display name, scores and win results may appear on the leaderboard. Avoid putting personal or sensitive information in your display name.
        </PrivacySection>

        <PrivacySection title="Saved on this device">
          Your display name is saved locally so it can be reused. On web, the room-session token is kept in session storage and normally clears when that browser tab closes. On iOS and Android, the token is kept in the device secure store. An explicit leave request or an invalid session clears the saved room session.
        </PrivacySection>

        <PrivacySection title="Server storage and retention">
          Active rooms and gameplay state are held in server memory. Periodic cleanup removes rooms that have been inactive for more than four hours. Room-session tokens expire after 24 hours. Where rankings are enabled, finished games may save game and room identifiers, rounds, player identifiers, display names, scores and win results. Leaving a room or clearing your device data does not delete a result already saved to the server. The server also produces request and error logs to operate and troubleshoot the service.
        </PrivacySection>

        <PrivacySection title="Providers and sharing">
          Hosting and database providers may process this information only to operate the arcade. The app does not currently include advertising, marketing trackers, payments, contact access, photo access or external-storage access, and it does not sell player data.
        </PrivacySection>

        <PrivacySection title="Your choices">
          Use the game’s Leave control to end your room session. You can clear app or site data to remove the saved display name where your platform supports it. Web session storage normally clears when its tab closes, although browser session restoration can preserve it. On some native platforms, secure-store values can survive reinstalling the app; room tokens still expire after 24 hours.
        </PrivacySection>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Privacy questions and requests</Text>
          <Text style={styles.body}>For questions about your information, or to request access, correction or removal of saved leaderboard data, email:</Text>
          <Link href="mailto:k.duy1202@gmail.com" accessibilityLabel="Email privacy contact k.duy1202@gmail.com" style={styles.contact}>k.duy1202@gmail.com</Link>
          <Text style={styles.body}>Include your display name, the game and the approximate date so we can locate the result. Never send a room password or session token.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: ARCADE.bg,
  },
  content: {
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 64,
  },
  title: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 4,
    ...neonText(ARCADE.cyan, 12),
  },
  updated: {
    marginTop: 8,
    color: ARCADE.muted,
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 12,
    textAlign: 'center',
  },
  intro: {
    marginTop: 16,
    color: ARCADE.text,
    fontFamily: 'Outfit_400Regular',
    fontSize: 18,
    lineHeight: 27,
    textAlign: 'center',
  },
  card: {
    gap: 24,
    marginTop: 30,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ARCADE.border,
    padding: 22,
    backgroundColor: ARCADE.surface,
  },
  section: {
    gap: 7,
  },
  sectionTitle: {
    color: ARCADE.text,
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 17,
  },
  body: {
    color: ARCADE.muted,
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
    lineHeight: 25,
  },
  contact: {
    color: ARCADE.cyan,
    fontFamily: 'Outfit_700Bold',
    fontSize: 16,
    lineHeight: 25,
    minHeight: 48,
    paddingVertical: 12,
    textDecorationLine: 'underline',
  },
});
