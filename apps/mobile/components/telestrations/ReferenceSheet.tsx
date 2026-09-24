import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { BookButton, typography as T } from './Controls';
import { RelayDiagram } from './RelayDiagram';
import { TELESTRATIONS as C } from './palette';

export function TelestrationsReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useWebModalFocus(visible, 'telestrations-rules', onClose);
  if (!visible) return null;
  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#101528F5', padding: 12 }}>
      <View nativeID="telestrations-rules" accessibilityViewIsModal accessibilityLabel="Telestrations rules" style={{ flex: 1, width: '100%', maxWidth: 840, alignSelf: 'center', backgroundColor: C.surface, borderRadius: 16 }}>
        <View style={{ padding: 16, gap: 12 }}><Text accessibilityRole="header" style={T.heading}>How the sketchbooks travel</Text><BookButton label="Close rules" quiet onPress={onClose} /></View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
          <Text style={T.body}>4–12 players, three rounds. Draw what you read, guess what you see, and enjoy the unexpected changes. No drawing skill required.</Text>
          <RelayDiagram />
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={T.heading}>Start with a secret</Text>
            <Text style={T.body}>Choose one of your three original prompt offers. With a shared category, invent your own secret within it instead. Do not say it aloud or show other players.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              {[[false, 'Even table', 'Draw your own prompt first.'], [true, 'Odd table', 'Your book passes before the first drawing.']] .map(([odd, label, detail]) => <View key={String(label)} style={{ flex: 1, minWidth: 190, gap: 8 }}>
                <MaterialCommunityIcons name={odd ? 'book-arrow-right-outline' : 'book-open-blank-variant'} color={C.secondary} size={36} />
                <Text style={[T.body, { fontFamily: 'Outfit_700Bold' }]}>{label}</Text><Text style={T.body}>{detail}</Text>
              </View>)}
            </View>
            <Text style={T.body}>The server assigns the right page. Alternate drawing and guessing until every book returns to its owner with a guess last. The selected passing direction applies to everyone.</Text>
          </View>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={T.heading}>One page, one interpretation</Text>
            <Text style={T.body}>Draw only pictures, with no letters or numbers. Do not leave a blank page. Guess the previous drawing, not an earlier word you remember. A guess cannot be empty or just a question mark.</Text>
            <Text style={T.body}>Lock in when ready. Everyone finishes before the books pass together. This 2025 edition has no countdown. Saved drafts return after reconnecting; keep the page open if work has not saved yet.</Text>
          </View>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={T.heading}>Reveal, then choose how to score</Text>
            <Text style={T.body}>Each owner reveals their book in order, starting with the secret. Once the last page is visible, the owner can review any page and make the human judgements below.</Text>
            {[
              ['Friendly', 'Favourite drawing: +1 to its artist. Favourite guess: +1 to its author. Final guess matches the secret: +1 to the owner.'],
              ['Competitive', 'For each guess matching the secret or the preceding guess: +1 to the guesser and +1 to the preceding artist. A final secret match also gives the owner +1.'],
              ['Just for laughs', 'Reveal every book without points. The prototype still plays three rounds; no winner is named.'],
            ].map(([label, text]) => <View key={label} style={{ gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={[T.body, { fontFamily: 'Outfit_700Bold', color: C.secondary }]}>{label}</Text><Text style={T.body}>{text}</Text>
            </View>)}
            <Text style={T.body}>Points settle only after every book is scored. After three full rounds, the highest total wins. Tied leaders share the win. The app never decides whether two ideas mean the same thing.</Text>
          </View>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={T.heading}>Leaving changes the table</Text>
            <Text style={T.body}>Leaving, or missing the reconnect grace period, immediately forfeits your seat. An unfinished round is cancelled, including its provisional points, and starts again with the remaining players. Settled scores stay. Fewer than four players ends the game without a winner.</Text>
            <Text style={T.muted}>Private prototype of the 2025 12-player rules. Digital adaptations: 72 original prompts in a shuffled pool, exhausted before reuse; three offers per player, three casual rounds, and the forfeit policy above.</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  </Modal>;
}
