import { Text, View } from 'react-native';
import type { ColtAction } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { COLT as C } from '../../constants/theme';
import { COLT_ACTION_HELP } from './decision';
import { ActionArtwork } from './ActionArtwork';
export { coltActionIcons } from './ActionArtwork';

export function ActionCard({ id, action, owner, disabled, mode = 'program', configure = false, fluid = false, onPress }: { id?: string; action: ColtAction | 'bullet'; owner: string; disabled: boolean; mode?: 'program' | 'reserve'; configure?: boolean; fluid?: boolean; onPress: () => void }) {
  const verb = mode === 'reserve' ? 'Reserve' : configure ? 'Configure optional Cover for' : 'Program';
  const accent = action === 'bullet' ? C.red : C.cyan;
  return <View nativeID={id} style={{ width: fluid ? '100%' : undefined, flexBasis: fluid ? 'auto' : 240, flexGrow: 1, minWidth: 0, paddingBottom: 4 }}><ScalePressable accessibilityLabel={`${verb} ${action} for ${owner}. ${COLT_ACTION_HELP[action]}`} accessibilityHint={configure ? 'Opens local Cover choices. Nothing is submitted yet.' : mode === 'reserve' ? 'Confirms this card as your private reserve.' : 'Submits this action now. Its effect resolves later in program order.'}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ flexGrow: 1, minWidth: 0, minHeight: 48, borderRadius: 12, opacity: 1 }}>
    <CardSurface fill radius={12} faceColor={C.panel} edgeColor="#10131B" highlightColor={disabled ? C.border : C.ember} depth={3}>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <ActionArtwork action={action} />
          <View style={{ flexBasis: 180, flexGrow: 1, minWidth: 0, gap: 4 }}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: C.text, fontSize: 20, lineHeight: 26 }}>{action.toUpperCase()}</Text>
            <Text style={{ fontFamily: 'Outfit_700Bold', color: C.gold, fontSize: 15, lineHeight: 22 }}>{owner}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 16, lineHeight: 24 }}>{COLT_ACTION_HELP[action]}</Text>
        <View style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}><Text style={{ fontFamily: 'Outfit_700Bold', color: disabled ? C.muted : accent, fontSize: 14, lineHeight: 21 }}>{disabled ? action === 'bullet' ? 'CANNOT BE PROGRAMMED' : 'NOT YOUR DECISION' : mode === 'reserve' ? 'RESERVE THIS CARD' : configure ? 'CHOOSE COVER OPTIONS' : 'PROGRAM THIS ACTION'}</Text></View>
      </View>
    </CardSurface>
  </ScalePressable></View>;
}
