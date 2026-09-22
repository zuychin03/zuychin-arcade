import { useEffect, useRef } from 'react';

export function useCitadelsDecisionAttention(key: string | null, blocked: boolean, focus: () => boolean) {
  const focusedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!key) {
      focusedKey.current = null;
      return;
    }
    if (blocked || focusedKey.current === key) return;
    const frame = requestAnimationFrame(() => {
      if (focus()) focusedKey.current = key;
    });
    return () => cancelAnimationFrame(frame);
  }, [key, blocked, focus]);
}
