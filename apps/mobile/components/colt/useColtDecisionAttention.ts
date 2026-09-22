import { useEffect, useRef } from 'react';

export function useColtDecisionAttention(key: string | null, blocked: boolean, focus: () => boolean) {
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!key) { focused.current = null; return; }
    if (blocked || focused.current === key) return;
    const frame = requestAnimationFrame(() => { if (focus()) focused.current = key; });
    return () => cancelAnimationFrame(frame);
  }, [key, blocked, focus]);
}
