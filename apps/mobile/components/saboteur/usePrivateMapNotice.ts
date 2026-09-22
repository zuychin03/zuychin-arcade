import { useEffect, useRef, useState } from 'react';
import type { PeekedGoal } from '@zuychin-arcade/types';

export function usePrivateMapNotice(peeks: PeekedGoal[], round: number) {
  const [message, setMessage] = useState<string | null>(null);
  const previous = useRef({ count: peeks.length, round });
  const count = peeks.length;
  const isGold = peeks.at(-1)?.isGold;
  useEffect(() => {
    const prior = previous.current;
    previous.current = { count, round };
    if (round !== prior.round || count < prior.count) { setMessage(null); return; }
    if (count <= prior.count) return;
    setMessage(isGold ? 'That goal is the GOLD!' : 'Just worthless stone…');
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [count, isGold, round]);
  return [message, () => setMessage(null)] as const;
}
