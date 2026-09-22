import { useRef, useState } from 'react';

export interface IntrinsicCardFaceSizing {
  minimumHeight: number;
  measurementKey: string;
  onMeasure: (height: number) => void;
}

export function useIntrinsicCardHeight(ids: readonly string[], layoutKey: string) {
  const members = [...new Set(ids)].sort();
  const epoch = JSON.stringify([layoutKey, members]);
  const latestEpoch = useRef(epoch);
  latestEpoch.current = epoch;
  const [measured, setMeasured] = useState<{ epoch: string; heights: Record<string, number> }>({ epoch, heights: {} });
  const heights = measured.epoch === epoch ? measured.heights : {};
  const minimumHeight = Math.max(0, ...members.map(id => heights[id] ?? 0));

  return {
    forCard(id: string): IntrinsicCardFaceSizing {
      return {
        minimumHeight,
        measurementKey: epoch,
        onMeasure(height) {
          if (latestEpoch.current !== epoch || !members.includes(id) || !Number.isFinite(height) || height <= 0) return;
          setMeasured(previous => {
            if (latestEpoch.current !== epoch) return previous;
            const current = previous.epoch === epoch ? previous.heights : {};
            if (current[id] === height) return previous;
            return { epoch, heights: { ...current, [id]: height } };
          });
        },
      };
    },
  };
}
