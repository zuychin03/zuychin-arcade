import { Modal, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { DIXIT as C } from '../../constants/theme';
import { NeonButton } from '../ui/NeonButton';
import { DreamCard } from './DreamCard';

const body = { color: C.text, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 } as const;
const heading = { color: C.accent, fontFamily: 'Outfit_700Bold', fontSize: 22 } as const;

export function DixitReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useWebModalFocus(visible, 'dixit-rules', onClose);
  const { width } = useWindowDimensions();
  if (!visible) return null;
  const cardWidth = Math.min(160, Math.max(90, (width - 76) / 2));
  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#080611F5', padding: 12 }}>
      <View nativeID="dixit-rules" accessibilityViewIsModal accessibilityLabel="Dixit Odyssey rules"
        style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center', backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}>
        <View style={{ padding: 16, gap: 12 }}>
          <Text accessibilityRole="header" style={heading}>Dixit Odyssey</Text>
          <NeonButton label="CLOSE RULES" variant="outline" color={C.accent} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
          <Text style={body}>3–12 storytellers. Reach 30 points, then finish that round. The highest score wins; tied leaders share the win.</Text>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={heading}>An image, a clue, many meanings</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
              <DreamCard cardId="dream-01" width={cardWidth} />
              <DreamCard cardId="dream-02" width={cardWidth} />
            </View>
            <Text style={body}>The storyteller chooses one image from their hand and gives a clue. A word, a phrase or a short quotation can work. Aim for a clue that some people understand, but not everyone.</Text>
            <Text style={body}>Everyone else secretly chooses one image that could fit the clue. The table shuffles those images with the storyteller’s image. You cannot see who contributed each one yet.</Text>
          </View>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={heading}>Two votes, one storyteller’s image</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {[1, 2].map(dial => <View key={dial} style={{ padding: 12, borderRadius: 12, backgroundColor: C.panel, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="circle-double" size={28} color={dial === 1 ? C.accent : C.secondary} />
                <Text style={body}>Vote {dial}</Text>
              </View>)}
            </View>
            <Text style={body}>Place both votes on one image, or split them across two. You cannot vote for your own image. The storyteller does not vote. Votes stay secret until everyone has locked theirs in.</Text>
            <Text accessibilityRole="header" style={heading}>Read the votes, then score</Text>
            {[
              ['Some votes correct', 'Storyteller: 3. Each correct vote: 3, so two correct votes earn 6.'],
              ['Every vote correct', 'Storyteller: 0. Every other player: 4.'],
              ['No votes correct', 'Storyteller: 0. Every other player: 2.'],
            ].map(([label, detail]) => <View key={label} style={{ gap: 4 }}>
              <Text style={{ ...body, fontFamily: 'Outfit_700Bold', color: C.secondary }}>{label}</Text>
              <Text style={body}>{detail}</Text>
            </View>)}
            <Text style={body}>In every case, each vote attracted by your own image adds 1 point. There is no cap on these decoy points. “Every vote correct” means both votes from every voter, not just one correct vote each.</Text>
          </View>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={heading}>A table for three</Text>
            <Text style={body}>Use seven cards each instead of six. Each non-storyteller submits two images, making a five-image table. Both of your images are ineligible for your votes. The same two-vote scoring applies.</Text>
            <Text accessibilityRole="header" style={heading}>Keep the story moving</Text>
            <Text style={body}>The first inspired player volunteers to tell the first story. After each reveal, everyone confirms they are ready. Refill hands, then move the storyteller clockwise. There is no countdown.</Text>
            <Text style={body}>Leaving or failing to reconnect before the grace period expires forfeits your seat. An unfinished round is cancelled without points; settled points stay. With fewer than three players, the game ends without a winner.</Text>
            <Text style={{ ...body, color: C.muted }}>This private prototype follows the 2024 Odyssey base rules with original illustrations. Older optional voting, Party and Team variants are not part of this edition.</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  </Modal>;
}
