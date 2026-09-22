import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';

type ApprovedNavigation = { identity: string | null; navigate: () => void; isCurrent: () => boolean };

export function useNativeLeaveGuard(identity: string | null, onAttempt: () => void) {
  const mounted = useRef(true);
  const currentIdentity = useRef(identity);
  const queued = useRef<ApprovedNavigation | null>(null);
  const executed = useRef<ApprovedNavigation | null>(null);
  const [approved, setApproved] = useState<ApprovedNavigation | null>(null);
  currentIdentity.current = identity;

  const approvedCurrent = approved?.identity === identity && approved.isCurrent();
  usePreventRemove(Platform.OS !== 'web' && identity !== null && !approvedCurrent, () => {
    if (mounted.current) onAttempt();
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; queued.current = null; };
  }, []);

  useEffect(() => {
    if (!approved || !mounted.current) return;
    if (approved.identity !== identity || !approved.isCurrent()) {
      queued.current = null;
      setApproved(null);
      return;
    }
    if (executed.current === approved) return;
    executed.current = approved;
    // Run after usePreventRemove has released its JavaScript removal listener.
    approved.navigate();
  }, [approved, identity]);

  return useCallback((navigate: () => void, isCurrent: () => boolean, destinationIdentity: string | null = identity) => {
    if (!mounted.current || currentIdentity.current !== identity || queued.current || !isCurrent()) return;
    if (Platform.OS === 'web') { navigate(); return; }
    const next = { identity: destinationIdentity, navigate, isCurrent };
    queued.current = next;
    setApproved(next);
  }, [identity]);
}
