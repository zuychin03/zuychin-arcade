import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ARCADE, neonText } from '../../constants/theme';

type SectionProps = {
  title: string;
  children: string;
};

function PrivacySection({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
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
      <Text style={styles.title}>PRIVACY</Text>
      <Text style={styles.updated}>IN-APP SUMMARY · 07/09/2026</Text>

      <View style={styles.card}>
        <PrivacySection title="Data used to run a game">
          The arcade processes your display name, room code, player identifier, signed room-session token, lobby choices, game actions and the public or player-specific state needed to play. If a room password is used, it is sent to the server for room creation or entry. The live server keeps only a salted password hash, not the readable password.
        </PrivacySection>

        <PrivacySection title="Saved on this device">
          Your display name is saved locally so it can be reused. On web, the room-session token is kept in session storage and normally clears when that browser tab closes. On iOS and Android, the token is kept in the device secure store. An explicit leave request or an invalid session clears the saved room session.
        </PrivacySection>

        <PrivacySection title="Server storage and retention">
          Active rooms and gameplay state are held in server memory and are removed after four hours without activity. Room-session tokens expire after 24 hours. When result storage is configured, a finished game may save the game and room identifiers, rounds, player count, player identifiers, display names, scores and win results for rankings. The server also produces operational request and error logs.
        </PrivacySection>

        <PrivacySection title="Providers and sharing">
          Hosting and database providers may process this information only to operate the arcade. The app does not currently include advertising, marketing trackers, payments, contact access, photo access or external-storage access, and it does not sell player data.
        </PrivacySection>

        <PrivacySection title="Your choices">
          You can use a nickname, use a game’s explicit leave control where offered, close the web tab to clear its web session token, and clear app or site data to remove the display name where your platform supports it. Native secure-store values can survive an app reinstall on some platforms, but room tokens expire after 24 hours. Requests about stored ranking results require the publisher contact shown on the official app or website listing.
        </PrivacySection>
      </View>

      <View style={styles.releaseNotice}>
        <Text style={styles.releaseTitle}>RELEASE REQUIREMENT</Text>
        <Text style={styles.releaseBody}>
          This engineering summary is not the final legal policy. Before public release, the publisher must provide a hosted privacy-policy URL and verified contact details, and review provider names, hosting regions, retention, age eligibility and user-rights wording for the deployment jurisdictions.
        </Text>
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
    fontSize: 10,
    letterSpacing: 1,
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
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 13,
    lineHeight: 21,
  },
  releaseNotice: {
    gap: 8,
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ARCADE.pink,
    padding: 18,
    backgroundColor: ARCADE.panel,
  },
  releaseTitle: {
    color: ARCADE.pink,
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  releaseBody: {
    color: ARCADE.text,
    fontFamily: 'Outfit_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
});
