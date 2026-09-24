interface Frame { revision: number; roomCode: string }

export function revisionPair<Public extends Frame, Private extends Frame & { playerId: string }>(options: {
  roomCode: () => string | null;
  playerId: () => string | null;
  current: () => Public | null;
  syncing: (value: boolean) => void;
  adopt: (shared: Public, owned: Private) => void;
}) {
  let shared: Public | null = null;
  let owned: Private | null = null;
  const accepts = (frame: Frame) => {
    const current = options.current();
    const previous = current?.roomCode === options.roomCode() ? current?.revision ?? 0 : 0;
    return frame.roomCode === options.roomCode() && Number.isSafeInteger(frame.revision)
      && frame.revision >= Math.max(0, previous, shared?.revision ?? 0, owned?.revision ?? 0);
  };
  const settle = () => {
    options.syncing(true);
    if (shared && owned && shared.revision === owned.revision) options.adopt(shared, owned);
  };
  return {
    public(frame: Public) { if (accepts(frame)) { shared = frame; settle(); } },
    private(frame: Private) {
      if (frame.playerId === options.playerId() && accepts(frame)) { owned = frame; settle(); }
    },
    reset() { shared = null; owned = null; options.syncing(true); },
  };
}
