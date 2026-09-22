import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { neonText } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';

export interface RulesPalette {
  background: string;
  surface: string;
  panel: string;
  border: string;
  accent: string;
  secondary: string;
  muted: string;
  text: string;
}

export interface RuleEntry {
  title: string;
  body: string;
  tag?: string;
}

export interface RuleSection {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  entries: RuleEntry[];
}

interface Props {
  visible: boolean;
  gameTitle: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  palette: RulesPalette;
  sections: RuleSection[];
  onClose: () => void;
}

export function RulesReferenceSheet({
  visible,
  gameTitle,
  subtitle,
  icon,
  palette,
  sections,
  onClose,
}: Props) {
  const reduceMotion = useReducedMotionPreference();
  useWebModalFocus(visible, 'rules-reference-sheet', onClose);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(160)}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.86)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <Pressable
          accessible={false}
          focusable={false}
          importantForAccessibility="no"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
        />

        <Animated.View
          nativeID="rules-reference-sheet"
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          accessibilityLabel={`${gameTitle} rulebook`}
          entering={reduceMotion ? undefined : FadeInUp.duration(220)}
          style={{
            width: '100%',
            maxWidth: 520,
            maxHeight: '90%',
            borderRadius: 22,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surface,
            overflow: 'hidden',
            boxShadow: '0 12px 36px rgba(0,0,0,0.82)',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: palette.border,
              backgroundColor: palette.panel,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${palette.accent}1F`,
                borderWidth: 1,
                borderColor: `${palette.accent}66`,
              }}
            >
              <MaterialCommunityIcons name={icon} size={21} color={palette.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                accessibilityRole="header"
                style={{
                  fontFamily: 'Outfit_800ExtraBold',
                  fontSize: 17,
                  letterSpacing: 1,
                  ...neonText(palette.accent, 8),
                }}
              >
                {gameTitle.toUpperCase()} · RULEBOOK
              </Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: palette.muted, fontSize: 11, lineHeight: 17, marginTop: 2 }}>
                {subtitle}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close rules"
              onPress={onClose}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <MaterialCommunityIcons name="close" size={22} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView
            tabIndex={Platform.OS === 'web' ? 0 : undefined}
            role={Platform.OS === 'web' ? 'region' : undefined}
            accessibilityLabel={`${gameTitle} rules and card reference`}
            contentContainerStyle={{ padding: 16, gap: 20 }}
            showsVerticalScrollIndicator={Platform.OS === 'web'}
          >
            {sections.map((section) => (
              <View key={section.title} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <MaterialCommunityIcons name={section.icon} size={15} color={palette.secondary} />
                  <Text
                    accessibilityRole="header"
                    style={{
                      fontFamily: 'Outfit_800ExtraBold',
                      color: palette.secondary,
                      fontSize: 11,
                      letterSpacing: 2,
                    }}
                  >
                    {section.title.toUpperCase()}
                  </Text>
                </View>

                {section.entries.map((entry) => (
                  <View
                    key={entry.title}
                    style={{
                      flexDirection: 'row',
                      gap: 11,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: palette.border,
                      backgroundColor: palette.background,
                      padding: 11,
                    }}
                  >
                    <View
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        marginTop: 5,
                        backgroundColor: palette.accent,
                        boxShadow: `0 0 7px ${palette.accent}`,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
                        <Text style={{ fontFamily: 'Outfit_700Bold', color: palette.text, fontSize: 13 }}>
                          {entry.title}
                        </Text>
                        {entry.tag ? (
                          <View
                            style={{
                              borderRadius: 6,
                              borderWidth: 1,
                              borderColor: `${palette.secondary}66`,
                              backgroundColor: `${palette.secondary}18`,
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                            }}
                          >
                            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: palette.secondary, fontSize: 10 }}>
                              {entry.tag.toUpperCase()}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={{
                          fontFamily: 'SpaceMono_400Regular',
                          color: palette.muted,
                          fontSize: 12,
                          lineHeight: 19,
                          marginTop: 3,
                        }}
                      >
                        {entry.body}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
