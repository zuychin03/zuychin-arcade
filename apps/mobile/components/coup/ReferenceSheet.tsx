import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
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

/** In-game rulebook: every character, action and the core rules — like the
 *  reference card that ships in the physical box. Opened from the table header. */
export function ReferenceSheet({ visible, variant, onClose }: Props) {
  if (!visible) return null;
  const characters = charactersForVariant(variant);

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
        }}
      >
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
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 16, ...neonText(COUP.gold, 8) }}>
            🎭 COUP · Reference
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 20 }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} showsVerticalScrollIndicator={false}>
          {/* core rules */}
          <View style={{ gap: 10 }}>
            {RULES_NOTES.map((n) => (
              <View key={n.title} style={{ flexDirection: 'row', gap: 10 }}>
                <Text style={{ fontSize: 16 }}>{n.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 13 }}>{n.title}</Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11, lineHeight: 16 }}>
                    {n.body}
                  </Text>
                </View>
              </View>
            ))}
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
                    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: accent, fontSize: 15, letterSpacing: 0.5 }}>
                      {ref.name.toUpperCase()}
                    </Text>
                    <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.text, fontSize: 11, lineHeight: 16 }}>
                      {ref.action}
                    </Text>
                    <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11 }}>
                      🛡️ Blocks: {ref.blocks}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* general actions */}
          <View style={{ gap: 10 }}>
            <SectionLabel>Actions · anyone</SectionLabel>
            {GENERAL_ACTIONS.map((a) => (
              <ActionRow key={a.name} action={a} />
            ))}
          </View>

          {/* reformation extras */}
          {variant === 'reformation' && (
            <View style={{ gap: 10 }}>
              <SectionLabel>Reformation</SectionLabel>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11, lineHeight: 16 }}>
                Players belong to two sides (⛪ Loyalist / ✊ Reformist). Coup, Assassinate and Steal only target the
                opposing side. Coins paid to Convert go to the 🏦 Treasury.
              </Text>
              {REFORMATION_ACTIONS.map((a) => (
                <ActionRow key={a.name} action={a} />
              ))}
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 10, letterSpacing: 2.5 }}>
      {children.toUpperCase()}
    </Text>
  );
}

function ActionRow({ action }: { action: ActionRef }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <Text style={{ fontSize: 22, width: 28, textAlign: 'center' }}>{action.emoji}</Text>
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
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: action.tagColor, fontSize: 9 }}>{action.tag}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11, lineHeight: 16 }}>
          {action.detail}
        </Text>
      </View>
    </View>
  );
}
