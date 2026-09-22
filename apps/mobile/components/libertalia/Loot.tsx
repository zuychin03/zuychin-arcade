import { Text, View, useWindowDimensions } from 'react-native';
import type { LibertaliaLootToken } from '@zuychin-arcade/types';
import { CardSurface } from '../ui/CardSurface';
import { CardGrid } from '../ui/CardGrid';
import { LibertaliaLootArtwork } from './LibertaliaArtwork';
import { LIBERTALIA_LOOT_HELP } from './decision';
import { LIBERTALIA as C } from '../../constants/theme';

export function LibertaliaLootCollection({ tokens, compact = false, textScale = 1, testID }: { tokens: readonly LibertaliaLootToken[]; compact?: boolean; textScale?: number; testID?: string }) {
  const { fontScale } = useWindowDimensions();
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1, Number.isFinite(textScale) ? textScale : 1);
  return <CardGrid items={tokens} keyExtractor={token => String(token.id)} minCardWidth={compact ? 120 : 260} maxCardWidth={compact ? 180 : 420} gap={8} textScale={scale} testID={testID}
    renderItem={token => <LibertaliaLoot token={token} compact={compact} fluid />} />;
}

export function LibertaliaLoot({ token, compact = false, decorative = false, fluid = false }: { token: LibertaliaLootToken; compact?: boolean; decorative?: boolean; fluid?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  return <View testID={`libertalia-loot-token-${token.id}`} accessible={!decorative} accessibilityLabel={decorative ? undefined : `${token.kind}. ${LIBERTALIA_LOOT_HELP[token.kind]}`} accessibilityElementsHidden={decorative} importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'} pointerEvents={decorative ? 'none' : undefined} style={{ ...(fluid ? { width: '100%' as const } : { flexBasis: (compact ? 120 : 260) * scale }), alignSelf: 'stretch', flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', paddingBottom: 4 }}>
    <CardSurface fill radius={12} depth={3} faceColor={C.panel} edgeColor={C.bg} highlightColor={C.border}>
      <View style={{ padding: 10, gap: 10, minWidth: 0, flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'center' : 'flex-start' }}>
        <LibertaliaLootArtwork kind={token.kind} size={compact ? 44 : 72} />
        <View style={compact ? { alignSelf: 'stretch', minWidth: 0 } : { flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: token.kind === 'relic' ? C.violet : C.gold, fontSize: compact ? 14 : 16, lineHeight: compact ? 20 : 22, textAlign: compact ? 'center' : 'left' }}>{token.kind.toUpperCase()}</Text>
          {!compact ? <Text style={{ fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 14, lineHeight: 21, marginTop: 4 }}>{LIBERTALIA_LOOT_HELP[token.kind]}</Text> : null}
        </View>
      </View>
    </CardSurface>
  </View>;
}
