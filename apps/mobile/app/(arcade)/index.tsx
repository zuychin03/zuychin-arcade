import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useGameStore } from '../../store/useGameStore';
import { ApiError, getRoom } from '../../lib/api';
import { isTokenExpired } from '../../lib/tokenUtils';
import { clearAuthIfMatches } from '../../lib/storage';
import { GameTile } from '../../components/ui/GameTile';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE, BANG, CARTOGRAPHERS, CITADELS, COLT, COUP, DIXIT, KRAKEN, LIBERTALIA, MINE, NOT_ALONE, SKULL_KING, TELESTRATIONS, TOKYO } from '../../constants/theme';
import { gameBaseRoute } from '../../lib/gameRoutes';

export default function ArcadeHub() {
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [libraryWidth, setLibraryWidth] = useState(0);
  const { width, height, fontScale = 1 } = useWindowDimensions();
  const textScale = Math.max(1, fontScale);
  const shortLandscape = height < 500 && width > height;
  const libraryColumns = shortLandscape ? 1 : libraryWidth >= 960 * textScale ? 3 : libraryWidth >= 600 * textScale ? 2 : 1;
  const tileWidth = libraryWidth > 0 ? Math.floor((libraryWidth - 14 * (libraryColumns - 1)) / libraryColumns) : undefined;
  const compactTiles = libraryColumns === 1;
  const token = useGameStore((s) => s.token);
  const playerId = useGameStore((s) => s.playerId);
  const roomCode = useGameStore((s) => s.roomCode);
  const room = useGameStore((s) => s.room);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const restoreSession = useCallback(async () => {
    if (requestController.current) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    requestController.current = controller;
    const isCurrent = () => id === requestId.current && useGameStore.getState().token === token;
    setRestoring(true);
    setRestoreError(null);
    const discardEndedSession = async () => {
      if (!token || !isCurrent()) return;
      try {
        await clearAuthIfMatches(token);
      } catch {
        if (isCurrent()) setRestoreError('This session has ended, but its saved details could not be cleared. Retry to finish removing it.');
        return;
      }
      if (isCurrent()) {
        setRestoring(false);
        useGameStore.getState().clearAll();
      }
    };
    try {
      if (!token || !roomCode || !playerId) return;
      if (isTokenExpired(token)) {
        await discardEndedSession();
        return;
      }
      const liveRoom = await getRoom(roomCode, token, controller.signal);
      if (!isCurrent()) return;
      if (!liveRoom.players.some((player) => player.playerId === playerId && !player.hasLeft)) {
        await discardEndedSession();
        return;
      }
      useGameStore.getState().setRoom(liveRoom);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        await discardEndedSession();
      } else {
        setRestoreError('We could not check your room. Your saved seat is still on this device. Check your connection and retry.');
      }
    } finally {
      if (id === requestId.current) {
        requestController.current = null;
        setRestoring(false);
      }
    }
  }, [token, roomCode, playerId]);

  useEffect(() => {
    void restoreSession();
    return () => {
      requestId.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [restoreSession]);

  const hasSession = !restoring && roomCode && room;

  return (
    <ScrollView
      className="flex-1 bg-arcade-bg"
      contentContainerStyle={{ padding: 20, paddingTop: 32, paddingBottom: 44 }}
    >
      <View style={{ width: '100%', maxWidth: 1280, alignSelf: 'center', gap: 24 }}>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{
          fontSize: 32,
          fontFamily: 'Outfit_800ExtraBold',
          color: ARCADE.text
        }}>
          Game library
        </Text>
        <Text style={{
          fontSize: 16,
          lineHeight: 24,
          fontFamily: 'Outfit_400Regular',
          color: ARCADE.muted,
        }}>
          Pick a game to read the rules, create a room or join friends.
        </Text>
      </View>

      {restoring && token ? (
        <Text accessibilityLiveRegion="polite" style={{ color: ARCADE.muted, fontSize: 14, lineHeight: 20 }}>Checking your saved room…</Text>
      ) : null}
      {restoreError ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="alert" style={{ color: ARCADE.text, fontSize: 16, lineHeight: 24 }}>{restoreError}</Text>
          <NeonButton label="RETRY SESSION" color={ARCADE.cyan} variant="outline" disabled={restoring} onPress={() => { void restoreSession(); }} />
        </View>
      ) : null}
      {hasSession && (
        <View>
          <ScalePressable
            onPress={() => {
              const base = gameBaseRoute(room.gameId);
              router.push(`${base}/${room.status === 'lobby' ? 'lobby' : 'game'}`);
            }}
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: ARCADE.cyan,
              backgroundColor: ARCADE.panel,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 48,
            }}
          >
            <MaterialCommunityIcons name="play-circle-outline" size={28} color={ARCADE.cyan} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 16, color: ARCADE.cyan }}>
                {room.status === 'lobby' ? 'Back to lobby' : room.status === 'finished' ? 'View game result' : 'Game in progress'}
              </Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 14, marginTop: 4 }}>
                Room {roomCode} · tap to rejoin
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={ARCADE.cyan} />
          </ScalePressable>
        </View>
      )}

      <View nativeID="arcade-game-library" onLayout={({ nativeEvent }) => setLibraryWidth(nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      <GameTile
        compact={compactTiles}
        horizontalCover={shortLandscape}
        width={tileWidth}
        nativeID="game-tile-saboteur"
        coverNativeID="game-cover-saboteur"
        coverSource={require('../../assets/game-art/saboteur-cover.webp')}
        title="SABOTEUR"
        icon="pickaxe"
        players="3–10 players"
        subtitle="hidden roles · dig for gold or sabotage the dig"
        accent={MINE.gold}
        onPress={() => router.push('/saboteur')}
      />
      <GameTile
        compact={compactTiles}
        width={tileWidth}
        nativeID="game-tile-coup"
        horizontalCover={shortLandscape}
        coverNativeID="game-cover-coup"
        coverSource={require('../../assets/game-art/coup-cover.webp')}
        title="COUP"
        icon="drama-masks"
        players="2–10 players"
        subtitle="bluff, challenge & deduce · last influence standing wins"
        accent={COUP.crimson}
        onPress={() => router.push('/coup')}
      />
      <GameTile
        compact={compactTiles}
        width={tileWidth}
        nativeID="game-tile-king-of-tokyo"
        horizontalCover={shortLandscape}
        coverNativeID="game-cover-tokyo"
        coverSource={require('../../assets/game-art/tokyo-cover.webp')}
        title="KING OF TOKYO"
        icon="city-variant-outline"
        players="2–6 players"
        subtitle="roll, fight and rule Tokyo"
        accent={TOKYO.lime}
        onPress={() => router.push('/king-of-tokyo')}
      />
      <GameTile
        compact={compactTiles}
        width={tileWidth}
        nativeID="game-tile-skull-king"
        horizontalCover={shortLandscape}
        coverNativeID="game-cover-skull"
        coverSource={require('../../assets/game-art/skull-cover.webp')}
        title="SKULL KING"
        icon="pirate"
        players="3–8 players"
        subtitle="secret bids · pirates, mermaids & exact tricks"
        accent={SKULL_KING.teal}
        onPress={() => router.push('/skull-king')}
      />
      <GameTile
        compact={compactTiles}
        width={tileWidth}
        nativeID="game-tile-citadels"
        horizontalCover={shortLandscape}
        coverNativeID="game-cover-citadels"
        coverSource={require('../../assets/game-art/citadels-cover.webp')}
        title="CITADELS"
        icon="castle"
        players="4–7 players"
        subtitle="secret roles · build the realm’s greatest city"
        accent={CITADELS.royal}
        onPress={() => router.push('/citadels')}
      />
      <GameTile
        compact={compactTiles}
        width={tileWidth}
        nativeID="game-tile-not-alone"
        horizontalCover={shortLandscape}
        coverNativeID="game-cover-not-alone"
        coverSource={require('../../assets/game-art/not-alone-cover.webp')}
        title="NOT ALONE"
        icon="alien-outline"
        players="2–7 players"
        subtitle="hidden locations · one Creature hunts the stranded team"
        accent={NOT_ALONE.signal}
        onPress={() => router.push('/not-alone')}
      />
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth} nativeID="game-tile-bang" coverNativeID="game-cover-bang" coverSource={require('../../assets/game-art/bang-cover.webp')} title="BANG!" icon="pistol" players="4–7 players" subtitle="hidden roles · shootouts, range and survival" accent={BANG.gold} onPress={() => router.push('/bang')}/>
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth} nativeID="game-tile-libertalia" coverNativeID="game-cover-libertalia" coverSource={require('../../assets/game-art/libertalia-cover.webp')} title="LIBERTALIA" icon="ship-wheel" players="2–6 players" subtitle="secret crew · loot three sky-pirate voyages" accent={LIBERTALIA.sky} onPress={() => router.push('/libertalia')}/>
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth} nativeID="game-tile-colt-express" coverNativeID="game-cover-colt" coverSource={require('../../assets/game-art/colt-cover.webp')} title="COLT EXPRESS" icon="train" players="2–6 players" subtitle="programmed actions · rob the moving train" accent={COLT.ember} onPress={() => router.push('/colt-express')}/>
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth}
        nativeID="game-tile-feed-the-kraken" coverNativeID="game-cover-feed-the-kraken" coverSource={require('../../assets/game-art/feed-the-kraken-cover.webp')}
        title="FEED THE KRAKEN" icon="ferry" players="5–11 players" subtitle="hidden allegiances · steer a treacherous voyage" accent={KRAKEN.accent}
        onPress={() => router.push('/feed-the-kraken')} />
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth}
        nativeID="game-tile-telestrations" coverNativeID="game-cover-telestrations" coverSource={require('../../assets/game-art/telestrations-cover.webp')}
        title="TELESTRATIONS" icon="draw" players="4–12 players" subtitle="draw, guess & reveal · watch your idea transform" accent={TELESTRATIONS.accent}
        onPress={() => router.push('/telestrations')} />
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth}
        nativeID="game-tile-cartographers-heroes" coverNativeID="game-cover-cartographers-heroes" coverSource={require('../../assets/game-art/cartographers-heroes-cover.webp')}
        title="CARTOGRAPHERS HEROES" icon="map-outline" players="1–100 players" subtitle="draw together · chart a realm across four seasons" accent={CARTOGRAPHERS.accent}
        onPress={() => router.push('/cartographers-heroes')} />
      <GameTile compact={compactTiles} horizontalCover={shortLandscape} width={tileWidth}
        nativeID="game-tile-dixit-odyssey" coverNativeID="game-cover-dixit-odyssey" coverSource={require('../../assets/game-art/dixit-odyssey-cover.webp')}
        title="DIXIT ODYSSEY" icon="image-multiple-outline" players="3–12 players" subtitle="a clue, two votes · step into a gallery of dreams" accent={DIXIT.accent}
        onPress={() => router.push('/dixit-odyssey')} />
      </View>
      </View>
    </ScrollView>
  );
}
