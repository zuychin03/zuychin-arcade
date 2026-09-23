import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupVariant } from '@zuychin-arcade/types';
import { charactersForVariant } from '@zuychin-arcade/types';
import { CharacterCard } from './CharacterCard';
import { CoupTableArtwork } from './CoupTableArtwork';
import { CardGrid } from '../ui/CardGrid';
import { COUP, COUP_CHARACTER_COLOR } from '../../constants/theme';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import {
  CHARACTER_REF,
  GENERAL_ACTIONS,
  REFORMATION_ACTIONS,
  RULES_NOTES,
  type ActionRef,
} from '../../constants/coupReference';

interface Props {
  visible: boolean;
  variant: CoupVariant;
  onClose: () => void;
}

const RULES_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Goal: 'trophy-outline',
  Challenge: 'flag-outline',
  Block: 'shield-outline',
  Coins: 'cash-multiple',
  Assassination: 'sword-cross',
  'Double danger': 'alert-octagon-outline',
};

const ACTION_ICONS_REF: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  'Income': 'cash-multiple',
  'Foreign Aid': 'bank-transfer-in',
  'Coup': 'flash-alert',
  'Convert': 'swap-horizontal',
  'Embezzle': 'bank-minus',
};

export function ReferenceSheet({ visible, variant, onClose }: Props) {
  useWebModalFocus(visible, 'coup-rules', onClose);
  const reducedMotion = useReducedMotionPreference();
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <SafeAreaView
        style={{ flex: 1, width: '100%' }}
        edges={['top', 'bottom']}
      >
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(180)}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.82)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <Pressable accessible={false} importantForAccessibility="no" {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />

        <Animated.View
          nativeID="coup-rules"
          accessibilityLabel="Coup rules"
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          entering={reducedMotion ? undefined : FadeInUp.duration(220)}
          style={{
            width: '100%',
            maxWidth: 860,
            maxHeight: '88%',
            borderRadius: 20,
            borderWidth: 1,
            borderColor: COUP.border,
            backgroundColor: COUP.surface,
            overflow: 'hidden',
            boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
          }}
        >
          <ReferenceBody variant={variant} onClose={onClose} />
        </Animated.View>
      </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

export function ReferencePanel({ variant, style }: { variant: CoupVariant; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        { borderLeftWidth: 1, borderLeftColor: COUP.border, backgroundColor: COUP.surface, overflow: 'hidden' },
        style,
      ]}
    >
      <ReferenceBody variant={variant} fillHeight />
    </View>
  );
}

function ReferenceBody({
  variant,
  onClose,
  fillHeight,
}: {
  variant: CoupVariant;
  onClose?: () => void;
  fillHeight?: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: COUP.border,
          backgroundColor: COUP.panel,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexBasis: 180, flexGrow: 1, flexShrink: 1, maxWidth: '100%', minWidth: Platform.OS === 'web' ? 'min-content' as ViewStyle['minWidth'] : Math.min(200 * fontScale, width - 64) }}><MaterialCommunityIcons name="drama-masks" size={18} color={COUP.crimson} /><Text style={{ flex: 1, minWidth: 0, fontFamily: 'Outfit_800ExtraBold', fontSize: 16, color: COUP.text }}>{variant === 'base' ? 'Base Coup' : 'Reformation + Inquisitor'} · Reference</Text></View>
        {onClose && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close rules"
            onPress={onClose}
            style={{ width: 48, height: 48, flexShrink: 0, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' }}
          >
            <MaterialCommunityIcons name="close" size={21} color={COUP.muted} />
          </Pressable>
        )}
      </View>

      <ScrollView
        {...(Platform.OS === 'web' ? { tabIndex: 0, role: 'region' as const } : {})}
        accessibilityLabel="Coup rules content"
        style={fillHeight ? { flex: 1 } : undefined}
        contentContainerStyle={{ padding: 16, gap: 18 }}
        showsVerticalScrollIndicator
      >
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 24, lineHeight: 31 }}>Two influences. One survivor.</Text>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 25 }}>Keep your two character cards hidden. You may claim any character, even one you do not hold. Lose both influences and you are out; the last player with influence wins.</Text>
          <CharacterGallery variant={variant} />
        </View>
        <View style={{ gap: 12 }}>
          <SectionLabel>A claim at the table</SectionLabel>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 25 }}>Example: “I am the Duke. I take 3 coins.” The portrait tells you the claim, not whether the player is telling the truth.</Text>
          {[
            ['Allow', 'Nobody challenges: the player takes 3 coins without showing a card.'],
            ['Challenge → Duke shown', 'The challenger loses one influence. The Duke is shuffled back and replaced privately; the Tax succeeds.'],
            ['Challenge → claimant concedes', 'The claimant loses one influence. The Tax fails, so they take no coins. They may concede even if they hold the Duke.'],
          ].map(([title, body]) => <View key={title} style={{ gap: 5, borderBottomWidth: 1, borderBottomColor: COUP.border, paddingBottom: 12 }}>
            <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 17 }}>{title}</Text>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 25 }}>{body}</Text>
          </View>)}
        </View>
        <View style={{ gap: 12 }}>
          {RULES_NOTES.map((n) => {
            const iconName = RULES_ICONS[n.title] || 'help-circle-outline';
            return (
              <View key={n.title} style={{ flexDirection: 'row', gap: 12 }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: `${COUP.crimson}1C`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 0.5,
                    borderColor: `${COUP.crimson}40`,
                  }}
                >
                  <MaterialCommunityIcons name={iconName} size={15} color={COUP.crimson} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 17 }}>{n.title}</Text>
                  <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.muted, fontSize: 16, lineHeight: 25 }}>
                    {variant === 'reformation' && n.title === 'Block' ? 'The target may block Steal or Assassinate with a listed character. Only the opposing allegiance may Duke-block Foreign Aid, unless all living players share one side. Any living player may challenge a block.' : n.body}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View
          accessibilityRole="summary"
          style={{ borderRadius: 14, borderWidth: 1, borderColor: `${COUP.blue}66`, backgroundColor: `${COUP.blue}10`, padding: 12, gap: 5 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <MaterialCommunityIcons name="cellphone-link" size={16} color={COUP.blue} />
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.blue, fontSize: 13, letterSpacing: 1.4 }}>
              DIGITAL TABLE
            </Text>
          </View>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.muted, fontSize: 16, lineHeight: 25 }}>
            The first game follows room order; the previous winner starts a rematch. In a two-player game, the first player starts with 1 coin. Response windows last 30 seconds and use legal defaults if no decision arrives. A temporary disconnection keeps your seat during reconnect grace. Leaving or letting that grace expire forfeits your remaining influence. Already resolved challenge losses still apply. One remaining player wins; if nobody remains, the game ends without a winner or competitive result.
          </Text>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.gold, fontSize: 16, lineHeight: 25 }}>
            On timeout: ordinary responses allow the action or block; a challenged player proves the claim if held, otherwise concedes. Influence loss reveals the first remaining card. Exchange keeps the original hand. These decision defaults are separate from reconnect grace.
          </Text>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.gold, fontSize: 16, lineHeight: 25 }}>
            {variant === 'base' ? 'This table uses Base Coup, for 2–6 players. The Ambassador exchanges two cards.' : 'This table uses Reformation + Inquisitor, for 2–10 players. On timeout the starting allegiance is Reformist; an examined player shows their first hidden card and the Inquisitor returns it.'}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <SectionLabel>Actions · anyone</SectionLabel>
          {GENERAL_ACTIONS.map((a) => (
            <ActionRow key={a.name} action={a} />
          ))}
        </View>

        {variant === 'reformation' && (
          <View style={{ gap: 12 }}>
            <SectionLabel>Reformation</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {(['loyalist', 'reformist', 'treasury'] as const).map(kind => <View key={kind} style={{ flexBasis: 100, flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: 'center', gap: 8 }}>
                <View style={{ width: 72, maxWidth: '100%', borderRadius: 10, overflow: 'hidden' }}><CoupTableArtwork kind={kind} /></View>
                <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>{kind === 'loyalist' ? 'Loyalist' : kind === 'reformist' ? 'Reformist' : 'Treasury Reserve'}</Text>
              </View>)}
            </View>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.muted, fontSize: 16, lineHeight: 25 }}>
              The starting player chooses Loyalist or Reformist, then the other seats alternate sides. Coup, Assassinate, Steal and Examine may only target the opposing side. You may only Duke-block Foreign Aid from the opposing side. Once every living player shares a side, these restrictions lift. There is no team victory: the last player with influence wins. Convert can change your own side for 1 coin or anyone else’s for 2; those coins go to the Treasury Reserve.
            </Text>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 24 }}>Embezzle claims you have no hidden Duke. If challenged, prove it by showing all hidden cards, then replace them and take the Reserve; the challenger loses influence. Or concede, lose one influence and leave the Reserve untouched. You may bluff this claim even when holding a Duke.</Text>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 24 }}>The Inquisitor replaces the Ambassador and still blocks Steal. Exchange draws one card. For Examine, the target chooses one hidden card to show privately; the Inquisitor returns it or forces a replacement. Neither option loses influence. Both actions can be challenged.</Text>
            {REFORMATION_ACTIONS.map((a) => (
              <ActionRow key={a.name} action={a} />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function CharacterGallery({ variant }: { variant: CoupVariant }) {
  const { fontScale } = useWindowDimensions();
  return <View nativeID="coup-rules-characters" style={{ gap: 12 }}>
    <SectionLabel>{variant === 'base' ? 'The five characters' : 'The Reformation court'}</SectionLabel>
    <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.muted, fontSize: 16, lineHeight: 25 }}>Learn each portrait, its action and what it blocks. These are reference cards, not a player’s hand.</Text>
    <CardGrid items={charactersForVariant(variant)} keyExtractor={character => character} minCardWidth={208} maxCardWidth={280} textScale={fontScale}
      renderItem={character => <CharacterCard character={character} size="md" fluid
        accessibilityLabel={`${CHARACTER_REF[character].name}. ${CHARACTER_REF[character].action}. Blocks: ${CHARACTER_REF[character].blocks}`}
        referenceContent={<View style={{ gap: 10 }}>
        <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 25 }}>{CHARACTER_REF[character].action}</Text>
        <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP_CHARACTER_COLOR[character], fontSize: 16, lineHeight: 25 }}>Blocks: {CHARACTER_REF[character].blocks}</Text>
      </View>} />} />
  </View>;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 20, lineHeight: 28, marginBottom: 4 }}>
      {children}
    </Text>
  );
}

function ActionRow({ action }: { action: ActionRef }) {
  const iconName = ACTION_ICONS_REF[action.name] || 'cash';
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: `${action.tagColor}1C`,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 0.5,
          borderColor: `${action.tagColor}40`,
        }}
      >
        <MaterialCommunityIcons name={iconName} size={16} color={action.tagColor} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 17 }}>{action.name}</Text>
          <View
            style={{
              borderRadius: 6,
              borderWidth: 1,
              borderColor: `${action.tagColor}88`,
              backgroundColor: `${action.tagColor}1F`,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}
          >
            <Text style={{ fontFamily: 'Outfit_700Bold', color: action.tagColor, fontSize: 14 }}>{action.tag}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.muted, fontSize: 16, lineHeight: 25, marginTop: 2 }}>
          {action.detail}
        </Text>
      </View>
    </View>
  );
}
