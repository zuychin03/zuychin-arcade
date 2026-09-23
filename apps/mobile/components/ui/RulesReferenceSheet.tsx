import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  children?: ReactNode;
  onClose: () => void;
}

export function RulesReferenceSheet({
  visible,
  gameTitle,
  subtitle,
  icon,
  palette,
  sections,
  children,
  onClose,
}: Props) {
  const reduceMotion = useReducedMotionPreference();
  const { fontScale } = useWindowDimensions();
  useWebModalFocus(visible, 'rules-reference-sheet', onClose);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
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
            maxWidth: 900,
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
              flexWrap: 'wrap',
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
                flexShrink: 0,
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
            <View style={{ flexGrow: 1, flexShrink: 1, maxWidth: '100%', minWidth: Platform.OS === 'web' ? 'min-content' as ViewStyle['minWidth'] : 90 * fontScale }}>
              <Text
                accessibilityRole="header"
                style={{
                  fontFamily: 'Outfit_800ExtraBold',
                  fontSize: 17,
                  color: palette.accent,
                }}
              >
                Rulebook
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close rules"
              onPress={onClose}
              style={{ width: 48, height: 48, flexShrink: 0, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' }}
            >
              <MaterialCommunityIcons name="close" size={22} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView
            tabIndex={Platform.OS === 'web' ? 0 : undefined}
            role={Platform.OS === 'web' ? 'region' : undefined}
            accessibilityLabel={`${gameTitle} rules and card reference`}
            contentContainerStyle={{ padding: 16, gap: 28 }}
            showsVerticalScrollIndicator={Platform.OS === 'web'}
          >
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: palette.accent, fontSize: 24, lineHeight: 32 }}>{gameTitle}</Text>
              <Text style={{ fontFamily: 'Outfit_400Regular', color: palette.muted, fontSize: 16, lineHeight: 24 }}>{subtitle}</Text>
            </View>
            {children}
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: palette.text, fontFamily: 'Outfit_800ExtraBold', fontSize: 22 }}>Rules in detail</Text>
              <Text style={{ color: palette.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>Open a chapter for exact rules, scoring and digital-table differences.</Text>
              {sections.map((section) => <RuleChapter key={section.title} section={section} palette={palette} />)}
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

function RuleChapter({ section, palette }: { section: RuleSection; palette: RulesPalette }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={section.title} accessibilityState={{ expanded }} aria-expanded={Platform.OS === 'web' ? expanded : undefined}
      onPress={() => setExpanded(value => !value)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
      <MaterialCommunityIcons name={section.icon} size={20} color={palette.secondary} />
      <Text style={{ flex: 1, fontFamily: 'Outfit_700Bold', color: palette.text, fontSize: 18, lineHeight: 26 }}>{section.title}</Text>
      <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={palette.muted} />
    </Pressable>
    {expanded && <View style={{ gap: 20, paddingTop: 8, paddingBottom: 16 }}>
      {section.entries.map(entry => <View key={entry.title} style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', color: palette.secondary, fontSize: 17, lineHeight: 25 }}>{entry.title}</Text>
        {entry.tag ? <Text style={{ fontFamily: 'Outfit_700Bold', color: palette.muted, fontSize: 14 }}>{entry.tag}</Text> : null}
        <Text style={{ fontFamily: 'Outfit_400Regular', color: palette.text, fontSize: 16, lineHeight: 25 }}>{entry.body}</Text>
      </View>)}
    </View>}
  </View>;
}
