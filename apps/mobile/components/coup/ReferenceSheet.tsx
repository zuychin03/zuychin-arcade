import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupVariant } from '@zuychin-arcade/types';
import { charactersForVariant } from '@zuychin-arcade/types';
import { CharacterCard } from './CharacterCard';
import { COUP, COUP_CHARACTER_COLOR, neonText } from '../../constants/theme';
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
};

const ACTION_ICONS_REF: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  'Income': 'cash-multiple',
  'Foreign Aid': 'bank-transfer-in',
  'Coup': 'flash-alert',
  'Convert': 'swap-horizontal',
  'Embezzle': 'bank-minus',
};

/** Full-screen modal (narrow / on-demand via the Rules button). */
export function ReferenceSheet({ visible, variant, onClose }: Props) {
  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.82)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      {/* tap backdrop to dismiss */}
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />

      <Animated.View
        entering={FadeInUp.duration(220)}
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
  );
}

/** Persistent side panel (wide desktop) — same content, no modal chrome. */
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
      {/* header */}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><MaterialCommunityIcons name="drama-masks" size={18} color={COUP.gold} /><Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 16, ...neonText(COUP.gold, 8) }}>COUP · Reference</Text></View>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={21} color={COUP.muted} />
          </Pressable>
        )}
      </View>

      <ScrollView
        style={fillHeight ? { flex: 1 } : undefined}
        contentContainerStyle={{ padding: 16, gap: 18 }}
        showsVerticalScrollIndicator={false}
      >
        {/* core rules */}
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
                    backgroundColor: `${COUP.gold}1C`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 0.5,
                    borderColor: `${COUP.gold}40`,
                  }}
                >
                  <MaterialCommunityIcons name={iconName} size={15} color={COUP.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 13 }}>{n.title}</Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11, lineHeight: 16 }}>
                    {n.body}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* characters */}
        <View style={{ gap: 12 }}>
          <SectionLabel>Characters</SectionLabel>
          {characters.map((c) => {
            const ref = CHARACTER_REF[c];
            const accent = COUP_CHARACTER_COLOR[c];
            return (
              <View key={c} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <CharacterCard character={c} size="md" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: accent, fontSize: 14, letterSpacing: 0.5 }}>
                    {ref.name.toUpperCase()}
                  </Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.text, fontSize: 11, lineHeight: 16 }}>
                    {ref.action}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name="shield-outline" size={12} color={COUP.muted} />
                    <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11 }}>
                      Blocks: {ref.blocks}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* general actions */}
        <View style={{ gap: 12 }}>
          <SectionLabel>Actions · anyone</SectionLabel>
          {GENERAL_ACTIONS.map((a) => (
            <ActionRow key={a.name} action={a} />
          ))}
        </View>

        {/* reformation extras */}
        {variant === 'reformation' && (
          <View style={{ gap: 12 }}>
            <SectionLabel>Reformation</SectionLabel>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11, lineHeight: 16 }}>
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
    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 10, letterSpacing: 2.5, marginBottom: 4 }}>
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
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }}>
          {action.detail}
        </Text>
      </View>
    </View>
  );
}
