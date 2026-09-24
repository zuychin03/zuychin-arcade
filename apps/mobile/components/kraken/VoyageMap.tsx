import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { FEED_THE_KRAKEN_MAPS, type FeedTheKrakenJourney } from '@zuychin-arcade/types';
import { HelmButton, typography as T } from './Controls';
import { KRAKEN as C } from './palette';
import { COURSE_COLOURS as courseColours } from './NavigationCard';
const destinations: Record<string, string> = { pirate: 'Crimson Cove', cult: 'Kraken', sailor: 'Bluewater Bay' };
const actions = { cabin: 'Cabin search', flogging: 'Flogging', tongue: 'Cut tongue', feeding: 'Feed the Kraken' };
export function VoyageMap({ journey, nodeId = '0,0' }: { journey: FeedTheKrakenJourney; nodeId?: string }) {
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const vertical = useRef<ScrollView>(null), horizontal = useRef<ScrollView>(null);
  const nodes = FEED_THE_KRAKEN_MAPS[journey];
  const waypoints = Object.values(nodes).sort((a, b) => a.y - b.y || a.x - b.x);
  const label = (id: string, compact = false) => {
    if (id === '0,0') return 'Departure';
    if (destinations[id]) return destinations[id];
    const node = nodes[id], number = waypoints.findIndex(node => node.id === id);
    if (!node) return 'Unknown waypoint';
    if (compact) return node.action ? `${node.action === 'tongue' ? 'Tongue' : node.action[0].toUpperCase() + node.action.slice(1)} ${number}` : `W${number}`;
    return node.action ? `${actions[node.action]} (waypoint ${number})` : `Waypoint ${number}`;
  };
  const top = journey === 'quick' ? 9 : 11;
  const point = (id: string) => {
    const node = nodes[id];
    return node ? { x: 240 + node.x * 60, y: 50 + (top - node.y) * 52 } : { x: id === 'pirate' ? 45 : id === 'sailor' ? 435 : 240, y: 30 };
  };
  const current = nodes[nodeId];
  const ship = point(nodeId);
  const centreShip = useCallback(() => {
    if (!viewportWidth) return;
    vertical.current?.scrollTo({ y: Math.max(0, ship.y * zoom - 180), animated: false });
    horizontal.current?.scrollTo({ x: Math.max(0, ship.x * zoom - viewportWidth / 2), animated: false });
  }, [ship.x, ship.y, viewportWidth, zoom]);
  useEffect(centreShip, [centreShip]);
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={T.heading}>The {journey} voyage</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><HelmButton label="Find ship" quiet onPress={centreShip} /><HelmButton label="Zoom in" disabled={zoom >= 1.6} onPress={() => setZoom(Math.min(1.6, zoom + .2))} /><HelmButton label="Zoom out" disabled={zoom <= .6} onPress={() => setZoom(Math.max(.6, zoom - .2))} /></View>
    <Text style={T.muted}>Scroll within the chart to explore. The vessel marks your ship; W means waypoint. Red: pirates · blue: sailors · yellow: Kraken.</Text>
    <View onLayout={event => setViewportWidth(event.nativeEvent.layout.width)} style={{ height: 360, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
      <ScrollView ref={vertical} nestedScrollEnabled onContentSizeChange={centreShip}><ScrollView ref={horizontal} horizontal nestedScrollEnabled onContentSizeChange={centreShip}><Svg width={480 * zoom} height={(top * 52 + 100) * zoom} viewBox={`0 0 480 ${top * 52 + 100}`} accessibilityLabel={`${journey} voyage chart; ship at ${nodeId}`}>
        {Object.values(nodes).flatMap(node => Object.entries(node.routes).map(([colour, id]) => {
          const a = point(node.id), b = point(id);
          return <Line key={`${node.id}/${colour}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={courseColours[colour as keyof typeof courseColours]} strokeWidth={node.id === nodeId ? 5 : 1.5} opacity={node.id === nodeId ? 1 : .4} />;
        }))}
        {Object.values(nodes).map(node => { const p = point(node.id); return <ViewNode key={node.id} x={p.x} y={p.y} label={label(node.id, true)} current={node.id === nodeId} />; })}
        {['pirate', 'cult', 'sailor'].map(id => <SvgText key={id} x={point(id).x} y={25} textAnchor={id === 'pirate' ? 'start' : id === 'sailor' ? 'end' : 'middle'} fill={C.secondary} fontSize={15}>{label(id)}</SvgText>)}
      </Svg></ScrollView></ScrollView>
    </View>
    {current ? <Text style={T.body}>From {label(nodeId)}: {Object.entries(current.routes).map(([colour, id]) => `${colour} → ${label(id)}`).join(' · ')}</Text> : <Text style={T.body}>Destination: {label(nodeId)}</Text>}
  </View>;
}
function ViewNode({ x, y, label, current }: { x: number; y: number; label: string; current: boolean }) {
  return <><Circle cx={x} cy={y} r={current ? 14 : 7} fill={C.panel} stroke={current ? C.secondary : C.border} strokeWidth={2} />
    {current ? <G x={x} y={y} accessible={false}>
      <Path d="M-10 7 Q0 14 10 7 L7 11 L-6 11 Z" fill={C.bg} opacity={.7} />
      <Path d="M-11 4 L11 4 L6 9 L-6 9 Z" fill={C.secondary} stroke={C.bg} strokeWidth={1} />
      <Path d="M-1 -10 L-1 2 L-9 2 Z M2 -8 L9 1 L2 1 Z" fill={C.text} />
      <Line x1={0} y1={-11} x2={0} y2={5} stroke={C.secondary} strokeWidth={1.5} />
    </G> : null}
    <SvgText x={x} y={y + 26} textAnchor="middle" fill={C.text} fontSize={12}>{label}</SvgText></>;
}
