import { Modal, Platform, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupVariant } from '@zuychin-arcade/types';
import { charactersForVariant } from '@zuychin-arcade/types';
import { CharacterCard } from './CharacterCard';
import { COUP, COUP_CHARACTER_COLOR, neonText } from '../../constants/theme';
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
            maxWidth: 460,
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
  const characters = charactersForVariant(variant);

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: COUP.border,
          backgroundColor: COUP.panel,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><MaterialCommunityIcons name="drama-masks" size={18} color={COUP.crimson} /><Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 16, ...neonText(COUP.crimson, 8) }}>COUP · Reference</Text></View>
        {onClose && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close rules"
            onPress={onClose}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginVertical: -10, marginRight: -12 }}
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
                  <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 13 }}>{n.title}</Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13, lineHeight: 20 }}>
                    {n.body}
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
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, lineHeight: 20 }}>
            The first game follows room order; the previous winner starts a rematch. In a two-player game, the first player starts with 1 coin. Response windows last 30 seconds and use legal defaults if no decision arrives. A temporary disconnection keeps your seat during reconnect grace. Leaving or letting that grace expire forfeits your remaining influence. Already resolved challenge losses still apply. One remaining player wins; if nobody remains, the game ends without a winner or competitive result.
          </Text>
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 12, lineHeight: 20 }}>
            On timeout: ordinary responses allow the action or block; a challenged player proves the claim if held, otherwise concedes. Influence loss reveals the first remaining card. Exchange keeps the original hand. These decision defaults are separate from reconnect grace.
          </Text>
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 12, lineHeight: 20 }}>
            Base Coup is the only selectable mode in this release. Reformation remains unavailable until its full rules are supported.
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <SectionLabel>Characters</SectionLabel>
          {characters.map((c) => {
            const ref = CHARACTER_REF[c];
            const accent = COUP_CHARACTER_COLOR[c];
            return (
              <View key={c} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <CharacterCard character={c} size="md" />
                <View style={{ flexBasis: 200, flexGrow: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: accent, fontSize: 14, letterSpacing: 0.5 }}>
                    {ref.name.toUpperCase()}
                  </Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.text, fontSize: 13, lineHeight: 20 }}>
                    {ref.action}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name="shield-outline" size={12} color={COUP.muted} />
                    <Text style={{ flexShrink: 1, minWidth: 0, fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13 }}>
                      Blocks: {ref.blocks}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
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
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13, lineHeight: 20 }}>
              Players belong to two sides (Loyalist / Reformist). Coup, Assassinate and Steal only target the
              opposing side. Coins paid to Convert go to the Treasury.
            </Text>
            {REFORMATION_ACTIONS.map((a) => (
              <ActionRow key={a.name} action={a} />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 12, letterSpacing: 2.5, marginBottom: 4 }}>
      {children.toUpperCase()}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 13 }}>{action.name}</Text>
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
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: action.tagColor, fontSize: 9 }}>{action.tag.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13, lineHeight: 20, marginTop: 2 }}>
          {action.detail}
        </Text>
      </View>
    </View>
  );
}
