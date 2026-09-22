import { useState } from 'react';
import { Text, View } from 'react-native';
import { NOT_ALONE_MIN_PLAYERS, type NotAloneBoardFace } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { NotAloneMark } from '../../components/not-alone/NotAloneArtwork';
import { NotAloneReferenceSheet } from '../../components/not-alone/ReferenceSheet';
import { NOT_ALONE_PALETTE } from '../../components/not-alone/palette';
import { NOT_ALONE } from '../../constants/theme';
import { useGameStore } from '../../store/useGameStore';

export default function NotAloneLobby() {
  const [boardFace, setBoardFace] = useState<NotAloneBoardFace>('continuous');
  const ready = useGameStore(state => Boolean(state.notAlonePublic && state.notAlonePrivate && !state.notAloneSyncing));
  return <RemainingLobby base="/not-alone" gameName="Not Alone" minPlayers={NOT_ALONE_MIN_PLAYERS}
    mark={<NotAloneMark size={58} />} gameReady={ready}
    briefing="The host is the Creature; all other players are the Hunted. Explore secretly and keep the rescue signal alive. Use one shared voice channel: all table talk must be public to the Creature, while cards and destinations stay private."
    seatRoleLabel={seat => seat.isHost ? 'CREATURE' : 'HUNTED'}
    startPayload={{ boardFace }}
    renderStartOptions={disabled => <View style={{ gap: 9 }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.amber, fontSize: 14 }}>BOARD FACE · CREATURE CHOOSES</Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: NOT_ALONE.muted, fontSize: 13, lineHeight: 20 }}>Both printed faces use the same rules. Their marked Artemia spaces differ.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['continuous', 'alternating'] as const).map(face => <ScalePressable key={face} accessibilityLabel={face === 'continuous' ? 'Continuous board face' : 'Alternating board face'}
          accessibilityState={{ selected: boardFace === face, disabled }} disabled={disabled} onPress={() => setBoardFace(face)}
          style={{ flexBasis: 140, flexGrow: 1, minHeight: 64, padding: 12, borderRadius: 13, borderWidth: boardFace === face ? 2 : 1, borderColor: boardFace === face ? NOT_ALONE.signal : NOT_ALONE.border, backgroundColor: NOT_ALONE.surface }}>
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: boardFace === face ? NOT_ALONE.signal : NOT_ALONE.text, fontSize: 14 }}>{face.toUpperCase()}</Text>
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: NOT_ALONE.muted, fontSize: 13, lineHeight: 19 }}>{face === 'continuous' ? 'Final marked Rescue spaces' : 'Alternating marked Rescue spaces'}</Text>
        </ScalePressable>)}
      </View>
    </View>}
    renderRules={(visible, onClose) => <NotAloneReferenceSheet visible={visible} onClose={onClose} />}
    palette={NOT_ALONE_PALETTE} />;
}
