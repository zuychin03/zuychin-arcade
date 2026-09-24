import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { TelestrationsContent, TelestrationsPrivateState, TelestrationsPublicState } from '@zuychin-arcade/types';
import { DrawingEditor } from './DrawingEditor';
import { Drawing } from './Drawing';
import { EMPTY_DRAWING, drawingFits } from './drawingModel';
import { BookButton, typography as T } from './Controls';
import { TELESTRATIONS as C } from './palette';
import type { useTelestrationsActions } from './useTelestrationsActions';

export interface LocalBookDraft { content: TelestrationsContent; baseRevision: number }
export function BookDraft({ game, mine, actions, cached, remember, leaving }: { game: TelestrationsPublicState; mine: TelestrationsPrivateState; actions: ReturnType<typeof useTelestrationsActions>; cached?: LocalBookDraft; remember: (value: LocalBookDraft) => void; leaving: boolean }) {
  const restored = mine.draft!.content ?? (game.phase === 'draw' ? EMPTY_DRAWING : '');
  const [content, setContent] = useState<TelestrationsContent>(cached?.content ?? restored);
  const [baseRevision, setBaseRevision] = useState(cached?.baseRevision ?? mine.draft!.revision);
  const [conflict, setConflict] = useState(false);
  const send = useRef(actions.send); send.current = actions.send;
  const savingSnapshot = useRef<string | null>(null);
  const rememberCurrent = useRef(remember); rememberCurrent.current = remember;
  const contentText = JSON.stringify(content);
  const savedText = JSON.stringify(mine.draft!.content ?? (game.phase === 'draw' ? EMPTY_DRAWING : ''));
  const dirty = contentText !== savedText;
  const submitted = mine.draft!.submitted;
  const disabled = actions.busy && actions.pending !== 'draft' || leaving || submitted || conflict;
  const text = typeof content === 'string' ? content : '';
  const valid = typeof content === 'string' ? text.trim().length > 0 && !/^\?+$/.test(text.trim()) && [...text].length <= 120 && !/[\u0000-\u001f\u007f]/u.test(text)
    : content.strokes.length > 0 && drawingFits(content);
  const editableSave = typeof content === 'string' ? valid : drawingFits(content);
  useEffect(() => {
    if (mine.draft!.revision === baseRevision) return;
    if (dirty && savedText !== savingSnapshot.current) setConflict(true);
    else { savingSnapshot.current = null; setBaseRevision(mine.draft!.revision); }
  }, [mine.draft, baseRevision, dirty, savedText]);
  useEffect(() => { rememberCurrent.current({ content, baseRevision }); }, [content, baseRevision]);
  useEffect(() => {
    if (!dirty || !editableSave || disabled || conflict || actions.busy) return;
    const timer = setTimeout(() => {
      savingSnapshot.current = JSON.stringify(content);
      if (!send.current('draft', { content, windowId: mine.windowId!, seatToken: mine.seatToken! })) savingSnapshot.current = null;
    }, 750);
    return () => clearTimeout(timer);
  }, [content, dirty, editableSave, disabled, conflict, actions.busy, mine.windowId, mine.seatToken]);
  const change = (next: TelestrationsContent) => { setContent(next); remember({ content: next, baseRevision }); };
  const keep = (server: boolean) => {
    const next = server ? restored : content;
    setContent(next); setBaseRevision(mine.draft!.revision); setConflict(false); remember({ content: next, baseRevision: mine.draft!.revision });
  };
  return <View style={{ gap: 16 }}>
    {conflict ? <View accessibilityRole="alert" style={{ gap: 12 }}>
      <Text style={T.body}>A different saved draft arrived for this page. Choose which version to keep before editing.</Text>
      <BookButton label="Use the restored draft" onPress={() => keep(true)} />
      <BookButton label="Keep my unsaved version" quiet onPress={() => keep(false)} />
    </View> : null}
    {mine.predecessor ? <View style={{ gap: 8 }}>
      <Text style={T.heading}>{mine.predecessor.kind === 'draw' ? 'What do you see?' : 'Your drawing prompt'}</Text>
      {typeof mine.predecessor.content === 'string' ? <Text selectable style={[T.body, { fontSize: 22, lineHeight: 30, color: C.secondary }]}>{mine.predecessor.content}</Text>
        : <View accessibilityLabel="The previous player's drawing" style={{ overflow: 'hidden', borderRadius: 12 }}><Drawing drawing={mine.predecessor.content} /></View>}
    </View> : null}
    {game.phase === 'prompt' && !game.category ? <View style={{ gap: 12 }}>
      <Text style={T.body}>Choose one secret. It stays private until the reveal.</Text>
      {mine.choices.map(choice => <BookButton key={choice} label={choice} selected={text === choice} disabled={disabled} onPress={() => change(choice)} />)}
    </View> : game.phase === 'draw' && typeof content !== 'string'
      ? <DrawingEditor value={content} onChange={change} disabled={disabled} />
      : <View style={{ gap: 8 }}>
        <Text style={T.body}>{game.phase === 'prompt' ? `Invent a secret within “${game.category}”` : 'Your interpretation'}</Text>
        <TextInput testID="telestrations-word-input" accessibilityLabel={game.phase === 'prompt' ? 'Your secret prompt' : 'Your guess'} value={text} onChangeText={change}
          editable={!disabled} maxLength={120} multiline selectionColor={C.accent} placeholder={game.phase === 'prompt' ? 'Your own idea…' : 'What is in the drawing?'} placeholderTextColor={C.muted} style={T.input} />
        <Text style={T.muted}>Use one line, up to 120 characters. A question mark alone is not an answer.</Text>
      </View>}
    <Text testID="telestrations-draft-status" accessibilityLiveRegion="polite" style={T.muted}>{submitted ? 'Page locked. It cannot be changed.' : actions.pending === 'draft' ? 'Saving draft…' : dirty ? 'Changes on this device. They are not saved yet.' : 'Draft saved for reconnect.'}</Text>
    {!submitted ? <BookButton label={game.phase === 'prompt' ? 'Lock in secret' : game.phase === 'draw' ? 'Lock in drawing' : 'Lock in guess'} disabled={disabled || actions.busy || !valid} testID="telestrations-submit"
      onPress={() => { const submittedContent = typeof content === 'string' ? content.trim() : content; change(submittedContent); actions.send('submit', { content: submittedContent, windowId: mine.windowId!, seatToken: mine.seatToken! }); }} /> : null}
    {submitted ? <Text style={T.body}>{game.readyIds.length}/{game.seats.length} pages locked. Books pass only when everyone is ready.</Text> : null}
  </View>;
}
