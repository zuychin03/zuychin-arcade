import { useState } from 'react';
import { Text, View } from 'react-native';
import type { TelestrationsPublicState } from '@zuychin-arcade/types';
import { BookButton, typography as T } from './Controls';
import type { useTelestrationsActions } from './useTelestrationsActions';

function Verdict({ label, value, onChange, disabled }: { label: string; value: boolean | null; onChange: (value: boolean) => void; disabled: boolean }) {
  return <View style={{ gap: 8 }}><Text style={T.body}>{label}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    <BookButton label="Yes, a match" selected={value === true} disabled={disabled} onPress={() => onChange(true)} />
    <BookButton label="No match" selected={value === false} disabled={disabled} onPress={() => onChange(false)} />
  </View></View>;
}
export function Scoring({ game, actions, disabled }: { game: TelestrationsPublicState; actions: ReturnType<typeof useTelestrationsActions>; disabled: boolean }) {
  const [favouriteDrawing, setDrawing] = useState<number | null>(null);
  const [favouriteGuess, setGuess] = useState<number | null>(null);
  const [finalMatch, setFinal] = useState<boolean | null>(null);
  const guesses = game.scoringPages.filter(p => p.kind === 'guess');
  const [matches, setMatches] = useState<(boolean | null)[]>(() => guesses.map(() => null));
  const name = (id: string) => game.players.find(p => p.id === id)?.displayName ?? 'Departed player';
  const ready = game.scoringMode === 'none' || finalMatch !== null && (game.scoringMode === 'friendly' ? favouriteDrawing !== null && favouriteGuess !== null : matches.every(m => m !== null) && (!finalMatch || matches.at(-1) === true));
  return <View style={{ gap: 20 }}>
    <Text style={T.heading}>Judge your book</Text>
    <Text style={T.body}>Review any revealed page. You decide meaning; the app does not grade guesses.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <BookButton label="Review secret" quiet disabled={disabled} onPress={() => actions.send('review', { pageIndex: -1 })} />
      {game.scoringPages.map(p => <BookButton key={p.index} label={`Review page ${p.index + 1}`} quiet selected={game.revealPage === p.index} disabled={disabled} onPress={() => actions.send('review', { pageIndex: p.index })} />)}
    </View>
    {game.scoringMode === 'friendly' ? <View style={{ gap: 16 }}>
      <Text style={T.body}>Favourite drawing, one point to its artist</Text>
      {game.scoringPages.filter(p => p.kind === 'draw').map(p => <BookButton key={p.index} label={`Page ${p.index + 1}: ${name(p.authorId)}`} selected={favouriteDrawing === p.index} disabled={disabled} onPress={() => setDrawing(p.index)} />)}
      <Text style={T.body}>Favourite guess, one point to its author</Text>
      {guesses.map(p => <BookButton key={p.index} label={`Page ${p.index + 1}: ${name(p.authorId)}`} selected={favouriteGuess === p.index} disabled={disabled} onPress={() => setGuess(p.index)} />)}
    </View> : null}
    {game.scoringMode === 'competitive' ? guesses.map((p, i) => <Verdict key={p.index} label={`Does page ${p.index + 1}, by ${name(p.authorId)}, match the secret or the previous guess?`} value={matches[i]} disabled={disabled}
      onChange={value => setMatches(current => current.map((m, j) => i === j ? value : m))} />) : null}
    {game.scoringMode !== 'none' ? <Verdict label="Does the final guess match the original secret?" value={finalMatch} disabled={disabled} onChange={setFinal} /> : <Text style={T.body}>No points this time. Close the book when everyone has enjoyed the story.</Text>}
    {game.scoringMode === 'competitive' && finalMatch && matches.at(-1) !== true ? <Text accessibilityRole="alert" style={T.body}>A final secret match also counts as a matching final guess. Review that judgement above.</Text> : null}
    <BookButton testID="telestrations-score" label={game.scoringMode === 'none' ? 'Close this book' : 'Confirm these points'} disabled={disabled || !ready} onPress={() => actions.send('score', {
      ...(game.scoringMode !== 'none' ? { finalMatch: finalMatch! } : {}),
      ...(game.scoringMode === 'friendly' ? { favouriteDrawing: favouriteDrawing!, favouriteGuess: favouriteGuess! } : {}),
      ...(game.scoringMode === 'competitive' ? { matches: matches as boolean[] } : {}),
    })} />
  </View>;
}
