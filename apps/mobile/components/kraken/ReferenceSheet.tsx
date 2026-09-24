import { Modal, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FEED_THE_KRAKEN_CHARACTERS, FEED_THE_KRAKEN_CHARACTER_NAMES as N, FEED_THE_KRAKEN_CHARACTER_SUMMARIES as S } from '@zuychin-arcade/types';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { HelmButton, typography as T } from './Controls';
import { KRAKEN as C } from './palette';
import { CardGrid } from '../ui/CardGrid';
import { NavigationCard } from './NavigationCard';
import { NavigationFlow } from './NavigationFlow';
export function KrakenReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { fontScale } = useWindowDimensions();
  useWebModalFocus(visible, 'kraken-rules', onClose);
  if (!visible) return null;
  return <Modal visible transparent animationType="none" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: 12 }}><View nativeID="kraken-rules" accessibilityViewIsModal style={{ flex: 1, width: '100%', maxWidth: 840, alignSelf: 'center' }}>
    <HelmButton label="Close rules" onPress={onClose} /><ScrollView contentContainerStyle={{ gap: 24, paddingVertical: 24 }}><Text style={T.title}>A crew with three destinations</Text>
      <Text style={T.body}>Quick voyage: 5–11 players. Long voyage: 7–11. Sailors want the blue destination, pirates the red destination. The cult wins at the yellow destination or when its leader is fed to the Kraken. Keep faction cards, private observations and navigation hands hidden.</Text>
      <Text style={T.heading}>Read the course, then its effect</Text>
      <Text style={T.body}>The colour follows the matching route on the chart. Resolve a landing first, then the card’s effect. These three examples use the same faces as your hand.</Text>
      <CardGrid items={[
        { colour: 'blue', effect: 'drunk' }, { colour: 'red', effect: 'telescope' }, { colour: 'yellow', effect: 'uprising' },
      ] as const} keyExtractor={card => card.colour} minCardWidth={210} maxCardWidth={320} textScale={fontScale} renderItem={card => <NavigationCard card={card} />} />
      <NavigationFlow />
      <View style={{ gap: 20 }}>{[['1 · Appoint', 'Captain chooses a lieutenant and navigator. Off-duty signs constrain eligible appointments.'], ['2 · Mutiny', 'Crew secretly bid guns. Enough strength replaces the captain; tied candidates are excluded one by one. Successful mutiny spends committed guns, failed mutiny returns them.'], ['3 · Navigate', 'Captain and lieutenant each send one card. The navigator sees the shuffled pair, chooses one course and discards the other. No communication during card selection.'], ['4 · Land', 'Follow the actual coloured chart route, resolve its landing, then the card effect. A new command cycle follows.']].map(([title, body]) => <View key={title} style={{ gap: 6 }}><Text style={T.heading}>{title}</Text><Text style={T.body}>{body}</Text></View>)}</View>
      <Text style={T.heading}>The chart, not a straight line</Text><Text style={T.body}>Red, blue and yellow routes can bend around the coast. Use the displayed outgoing destinations, not a guessed direction. On the long map, crossing the supply boundary replenishes eligible holdings towards three guns, limited by the shared supply.</Text>
      <Text style={T.body}>Everyone starts with three guns. A completed navigation gives off-duty signs to the applicable navigation officers, according to the initial crew size. Previous off-duty signs return. Off duty restricts appointment as lieutenant or navigator, not holding captaincy; restrictions relax when too few eligible officers remain.</Text>
      <Text style={T.heading}>Landings</Text><Text style={T.body}>Cabin: the captain privately inspects a current faction. Flogging: reveal a faction the target does not belong to. Tongue: the target cannot speak words or become captain, but can still contribute guns. Feeding: the target goes overboard. Feeding the cult leader wins immediately for the cult.</Text>
      <Text style={T.heading}>Card effects and rituals</Text><Text style={T.body}>Drunk passes captaincy to an eligible player with the smallest navigation résumé, breaking ties clockwise. Armed gives the navigator one supply gun; disarmed removes one if available. Mermaid privately shows a chosen player the shuffled last three discarded cards. Telescope lets a chosen player inspect the top card and keep or discard it. Yellow uprising resolves a ritual: conversion, a secret stash of guns, or a cult search. Cult searches inspect original allegiance; normal cabin inspection sees current allegiance. A converted player joins the cult and learns its leader.</Text>
      <Text style={T.heading}>Private knowledge</Text><Text style={T.body}>Use the private panel away from other players’ view. Pirate knowledge, leader knowledge and conversion information appear only when the server permits them. Conversion immunity and negative faction clues are public. Do not infer a leader from a waiting screen.</Text>
      <Text style={T.body}>During a cult ritual, every player aboard completes a private step. Some players may have a secret choice; others simply confirm. Nothing settles until everyone has responded. This digital privacy step keeps a missing or ineligible hidden role from being exposed by the waiting screen.</Text>
      <Text style={T.heading}>Character windows</Text><Text style={T.body}>Priority passes clockwise. Use a character only in its offered window, or pass and preserve it. Revealing normally spends the ability; a mentor can restore another revealed character. The app enforces targets and gun limits.</Text>
      {FEED_THE_KRAKEN_CHARACTERS.map(id => <View key={id} style={{ gap: 6 }}><Text style={T.heading}>{N[id]}</Text><Text style={T.body}>{S[id]}</Text></View>)}
      <Text style={T.heading}>Refusal, reconnecting and leaving</Text><Text style={T.body}>A navigator may refuse and go overboard; the captain appoints a replacement with a fresh navigation draw and no new mutiny. A fed or refusing player can still win with their faction. Leaving explicitly forfeits immediately; a disconnected seat forfeits after the reconnection grace period. Forfeiture cannot trigger a feeding victory and removes that seat’s right to win. The server settles an interrupted committed action without exposing its secret cards. The voyage may continue with fewer players.</Text>
      <Text style={T.muted}>Private local digital prototype. Original code-native chart, no publisher artwork. Clockwise character priority and automated interruption settlement are digital adaptations. Speech restrictions rely on players honouring them outside the app.</Text>
    </ScrollView></View></SafeAreaView></Modal>;
}
