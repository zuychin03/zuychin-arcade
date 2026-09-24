import { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import type { CartographersAssignment, CartographersCard, CartographersMapSide, CartographersPlacementPayload, CartographersPoint, CartographersTerrain, CartographersTransform } from '@zuychin-arcade/types';
import { NeonButton } from '../ui/NeonButton';
import { ScalePressable } from '../ui/ScalePressable';
import { MapBoard, ShapeDiagram, TERRAIN } from './MapBoard';
import { ExploreCard } from './ExploreCard';
import { cellIndex, destructionTargets, placementPreview, shapeOptions, terrainOptions } from './geometry';
import { CARTOGRAPHERS as C } from './palette';

type Choice = Omit<CartographersPlacementPayload, 'turnId' | 'expectedRevision' | 'submissionToken' | 'targetPlayerId'>;
const body = { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: C.text } as const;
export function PlacementEditor({ assignment, card, side, destruction, busy, onPlace, onDestroy }: {
  assignment: CartographersAssignment; card: CartographersCard | null; side: CartographersMapSide; destruction: boolean; busy: boolean;
  onPlace: (choice: Choice) => void; onDestroy: (point: CartographersPoint) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [optionIndex, setOption] = useState(0);
  const [terrain, setTerrain] = useState<CartographersTerrain>(card ? terrainOptions(card, assignment.fallback)[0]! : 'monster');
  const [transform, setTransform] = useState<CartographersTransform>(assignment.fixedPlacement ?? { anchor: { x: 0, y: 0 }, rotation: 0, mirrored: false });
  const [destroyTarget, setDestroyTarget] = useState<CartographersPoint | null>(null);
  const [choosingDestruction, setChoosingDestruction] = useState(destruction);
  const [overview, setOverview] = useState(false);
  const preview = card && !destruction ? placementPreview(assignment, card, optionIndex, terrain, transform) : null;
  const targets = destruction ? destructionTargets(assignment.map, 'troll') : preview?.targets ?? [];
  const targetValid = destroyTarget !== null && targets.includes(cellIndex(destroyTarget));
  const valid = destruction ? targetValid : !!preview?.valid && (!targets.length || targetValid);
  const fixed = assignment.fixedPlacement !== null;
  const wide = width >= 1120 * Math.max(1, fontScale);
  const update = (next: CartographersTransform) => { setTransform(next); setDestroyTarget(null); setChoosingDestruction(false); };
  const chooseCell = (point: CartographersPoint) => {
    if (busy) return;
    if (destruction || choosingDestruction) { if (targets.includes(cellIndex(point))) setDestroyTarget(point); }
    else if (!fixed) update({ ...transform, anchor: point });
  };
  const controls = <View style={{ width: wide ? 320 : '100%', gap: 16 }}>
    {card && !destruction ? <ExploreCard card={card} /> : <Text style={body}>Choose one empty square beside a surviving Troll. Its destruction happens after this season’s score.</Text>}
    {assignment.fallback ? <Text style={{ ...body, color: C.secondary }}>No complete shape fits. Draw one square instead; named hero and monster powers do not apply.</Text> : null}
    {fixed ? <Text style={{ ...body, color: C.secondary }}>Solo ambush: the server fixed this position and orientation. Confirm it{targets.length ? ' after choosing a destruction target' : ''}.</Text> : null}
    {!destruction && card ? <>
      <Text accessibilityRole="header" style={{ ...body, fontFamily: 'Outfit_700Bold' }}>Terrain</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{terrainOptions(card, assignment.fallback).map(value => <ScalePressable key={value} disabled={busy}
        accessibilityLabel={`Use ${TERRAIN[value].label}`} accessibilityState={{ selected: terrain === value }} onPress={() => { setTerrain(value); setDestroyTarget(null); setChoosingDestruction(false); }}
        style={{ minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: terrain === value ? C.accent : C.panel }}>
        <Text style={{ ...body, color: terrain === value ? C.ink : C.text }}>{TERRAIN[value].label}</Text>
      </ScalePressable>)}</View>
      {shapeOptions(card, assignment.fallback).length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {shapeOptions(card, assignment.fallback).map((cells, index) => <ScalePressable key={index} disabled={busy} accessibilityLabel={`Use shape ${index + 1}`} accessibilityState={{ selected: optionIndex === index }}
          onPress={() => { setOption(index); setDestroyTarget(null); setChoosingDestruction(false); }} style={{ padding: 12, gap: 8, borderRadius: 12, borderWidth: 2, borderColor: optionIndex === index ? C.accent : C.border }}>
          <ShapeDiagram cells={cells} terrain={terrain} /><Text style={body}>Shape {index + 1}</Text>
        </ScalePressable>)}
      </View> : null}
      {!fixed ? <>
        <NeonButton label={`ROTATE · ${transform.rotation}°`} color={C.accent} variant="outline" disabled={busy} onPress={() => update({ ...transform, rotation: ((transform.rotation + 90) % 360) as CartographersTransform['rotation'] })} />
        <NeonButton label={transform.mirrored ? 'MIRRORED · RESTORE' : 'MIRROR SHAPE'} color={C.accent} variant="outline" disabled={busy} onPress={() => update({ ...transform, mirrored: !transform.mirrored })} />
      </> : null}
      <Text accessibilityLiveRegion="polite" style={{ ...body, color: preview?.valid ? C.secondary : C.danger }}>
        Anchor: column {transform.anchor.x + 1}, row {transform.anchor.y + 1}. {preview?.valid ? targets.length ? 'Shape fits. A Gorgon destruction target is required.' : 'Shape fits. Check the preview, then confirm.' : 'Shape overlaps a filled square or the map edge. Choose another position.'}
      </Text>
      {targets.length ? <NeonButton label={choosingDestruction ? 'SELECT A MARKED DESTRUCTION SQUARE' : 'CHOOSE GORGON DESTRUCTION'} color={C.danger} variant="outline" disabled={busy} onPress={() => { setChoosingDestruction(true); setOverview(false); }} /> : null}
    </> : null}
    {targetValid ? <Text accessibilityLiveRegion="polite" style={{ ...body, color: C.danger }}>Destroy column {destroyTarget!.x + 1}, row {destroyTarget!.y + 1}.</Text> : null}
    <NeonButton label={overview ? 'OPEN PLACEMENT GRID' : 'SHOW MAP OVERVIEW'} variant="ghost" color={C.accent} onPress={() => setOverview(!overview)} />
  </View>;
  return <View style={{ gap: 20 }}>
    <View style={{ flexDirection: wide ? 'row-reverse' : 'column', alignItems: 'flex-start', gap: 24 }}>
      {controls}
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', minWidth: 0 }}>
        <MapBoard map={assignment.map} side={side} label={assignment.displayName} interactive={!overview} disabled={busy} onCell={chooseCell}
          preview={preview?.cells} previewTerrain={terrain} valid={preview?.valid} attack={preview?.attack} targets={destruction || choosingDestruction ? targets : []} selectedTarget={destroyTarget ? cellIndex(destroyTarget) : null} />
        {!destruction && !fixed ? <View style={{ gap: 8 }}>
          <Text style={body}>Move the anchor one square</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[
            ['Left', -1, 0], ['Up', 0, -1], ['Down', 0, 1], ['Right', 1, 0],
          ].map(([label, dx, dy]) => <ScalePressable key={label} disabled={busy || transform.anchor.x + Number(dx) < 0 || transform.anchor.x + Number(dx) > 10 || transform.anchor.y + Number(dy) < 0 || transform.anchor.y + Number(dy) > 10}
            accessibilityLabel={`Move anchor ${label}`} onPress={() => update({ ...transform, anchor: { x: transform.anchor.x + Number(dx), y: transform.anchor.y + Number(dy) } })}
            style={{ minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: C.panel }}><Text style={body}>{label}</Text></ScalePressable>)}</View>
        </View> : null}
      </View>
    </View>
    <Text style={{ ...body, color: C.muted }}>The preview is a guide. The server checks and locks the final move.</Text>
    <NeonButton label={busy ? 'CONFIRMING…' : destruction ? 'CONFIRM DESTRUCTION' : `CONFIRM ON ${assignment.displayName.toLocaleUpperCase()}’S MAP`} color={C.accent} disabled={busy || !valid}
      onPress={() => {
        if (!valid) return;
        if (destruction) onDestroy(destroyTarget!);
        else onPlace({ ...transform, optionIndex, terrain, ...(targets.length && destroyTarget ? { destroyTarget } : {}) });
      }} />
  </View>;
}
