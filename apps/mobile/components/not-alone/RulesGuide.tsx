import { Text, View, useWindowDimensions } from 'react-native';
import { useIntrinsicCardHeight } from '../../hooks/useIntrinsicCardHeight';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NOT_ALONE_PLACES, NOT_ALONE_SURVIVAL_BY_ID, NOT_ALONE_HUNT_BY_ID } from '@zuychin-arcade/types';
import { PowerArtwork } from './PowerArtwork';
import { NotAlonePlaceCard } from './PlaceCard';
import { CardSurface } from '../ui/CardSurface';
import { NOT_ALONE as C } from '../../constants/theme';

const body = { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 25, color: C.text } as const;
const heading = { fontFamily: 'Outfit_800ExtraBold', fontSize: 23, lineHeight: 30, color: C.signal } as const;

export function NotAloneRulesGuide() {
  const { width, fontScale } = useWindowDimensions();
  const placeFaces = useIntrinsicCardHeight(NOT_ALONE_PLACES.map(place => String(place.id)), `${width}:${fontScale}`);
  return <View testID="not-alone-rules-guide" style={{ gap: 24, minWidth: 0 }}>
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={heading}>One planet. Two opposing goals.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
        {[
          { name: 'The Creature', icon: 'alien-outline' as const, color: C.creature, text: 'One player hunts. Predict the hidden destinations and advance Assimilation.' },
          { name: 'The Hunted', icon: 'account-group-outline' as const, color: C.signal, text: 'Everyone else survives together. Use Places and Survival cards to advance Rescue.' },
        ].map(side => <View key={side.name} style={{ flexBasis: 200, flexGrow: 1, minWidth: 0, gap: 7 }}>
          <MaterialCommunityIcons name={side.icon} size={36} color={side.color} accessible={false} />
          <Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold', color: side.color }}>{side.name}</Text><Text style={body}>{side.text}</Text>
        </View>)}
      </View>
      <Text style={body}>Each side has its own progress track. The first marker to reach its goal wins immediately. The host is the Creature; Hunted table talk must be public to the Creature.</Text>
      {[
        ['Rescue', 'Safe powers and the end of a normal round advance Rescue.', C.signal],
        ['Assimilation', 'Catches, giving up and losing the last Will advance Assimilation.', C.creature],
      ].map(([name, text, color]) => <View key={name} style={{ gap: 6 }}>
        <Text style={{ ...body, color, fontFamily: 'Outfit_700Bold' }}>{name} → its goal</Text>
        <Text style={body}>{text}</Text>
      </View>)}
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>A round unfolds in four phases</Text>
      <Text style={body}>Illustrated example only. No card here represents a player’s live hand or destination.</Text>
      <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>1 · Explore in secret</Text>
      <CardSurface radius={14} depth={3} faceColor={C.panel} edgeColor={C.bg} highlightColor={C.border}>
        <View accessible accessibilityLabel="Face-down example destination. Its identity stays hidden until reveal." style={{ padding: 24, alignItems: 'center', gap: 10 }}>
          <MaterialCommunityIcons name="fingerprint" size={58} color={C.signal} accessible={false} />
          <Text style={{ ...body, textAlign: 'center' }}>Destination hidden</Text>
        </View>
      </CardSurface>
      <Text style={body}>Each Hunted locks a Place from their hand. Others can see readiness, but neither the Creature nor teammates can see the chosen destination.</Text>
      <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>2 · Place the hunt</Text>
      <Text style={body}>The Creature commits the required Hunt tokens. Legal phase-two reactions happen after that plan is locked and before destinations are revealed.</Text>
      <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>3 · Reveal and reckon</Text>
      <View nativeID="not-alone-rules-reveal" style={{ alignItems: 'center', gap: 10 }}><NotAlonePlaceCard placeId={2} /><Text style={body}>Example reveal: The Jungle</Text></View>
      <Text style={body}>Resolve safe Places first, then Target, Artemia and Creature effects. A safe Hunted normally chooses the Place’s power or recovers one discarded Place.</Text>
      <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>4 · Recover the table</Text>
      <Text style={body}>Finish end-of-round effects, discard played cards, refill the Creature’s hand and advance Rescue unless an effect prevents it.</Text>
    </View>
    <View style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={heading}>Read the token on your Place</Text>
      {[
        { name: 'Creature', icon: 'alien-outline' as const, color: C.creature, text: 'Lose one Will and do not use or recover from that Place. One or more catches advance Assimilation once for the round. The Lair has an extra Will penalty.' },
        { name: 'Target', icon: 'crosshairs' as const, color: C.amber, text: 'Read the active Hunt card: it determines this token’s effect. A Target is not always a Creature.' },
        { name: 'Artemia', icon: 'hexagon-outline' as const, color: C.violet, text: 'Privately discard one other Place from hand. You cannot resolve the explored Place’s power.' },
      ].map(token => <View key={token.name} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <MaterialCommunityIcons name={token.icon} size={32} color={token.color} accessible={false} />
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text style={{ ...body, fontFamily: 'Outfit_700Bold', color: token.color }}>{token.name}</Text><Text style={body}>{token.text}</Text></View>
      </View>)}
      <Text style={body}>Will is not elimination: losing your last Will during Reckoning advances Assimilation again, restores three Will and returns your discarded Places. Before locking a destination, Resist trades Will for selected discards; Give Up restores all three Will and every discard but advances Assimilation.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Two kinds of power cards</Text>
      <Text style={body}>Public examples only, not anyone’s hand. Card timing and effects stay printed below the illustration.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
        {[{ card: NOT_ALONE_SURVIVAL_BY_ID.dodge, kind: 'Survival', color: C.signal }, { card: NOT_ALONE_HUNT_BY_ID.clone, kind: 'Hunt', color: C.creature }].map(({ card, kind, color }) => <View key={card.id} style={{ flexBasis: 240, flexGrow: 1, minWidth: 0 }}>
          <CardSurface fill radius={14} depth={3} faceColor={C.surface} edgeColor={C.bg} highlightColor={color}>
            <View style={{ padding: 12, gap: 12 }}>
              <Text style={{ ...body, color, fontFamily: 'Outfit_700Bold' }}>{card.name} · {kind} · P{card.phase}</Text>
              <PowerArtwork cardId={card.id} color={color} />
              <Text style={body}>{card.summary}</Text>
            </View>
          </CardSurface>
        </View>)}
      </View>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Learn the ten Places</Text>
      <Text style={body}>An open card catalogue, not your hand. The Rover explores advanced Places from the shared reserve; possessing a Place and resolving its power are different things.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
        {NOT_ALONE_PLACES.map(place => <NotAlonePlaceCard key={place.id} placeId={place.id} faceSizing={placeFaces.forCard(String(place.id))} />)}
      </View>
    </View>
  </View>;
}
