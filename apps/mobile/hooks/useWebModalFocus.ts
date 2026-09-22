import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useWebModalFocus(visible: boolean, panelId: string, onEscape: () => void): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let focusFrame: number | undefined;
    let active = true;
    let observedPanel: HTMLElement | null = null;
    let lastPanelFocus: Element | null = null;
    const lostRemovedControl = (panel: HTMLElement) => lastPanelFocus !== null
      && !panel.contains(lastPanelFocus)
      && (document.activeElement === document.body || document.activeElement === null);
    const rememberPanelFocus = () => {
      if (observedPanel?.contains(document.activeElement)) lastPanelFocus = document.activeElement;
    };
    const observer = new MutationObserver(() => {
      if (active && observedPanel && lostRemovedControl(observedPanel) && focusFrame === undefined) {
        focusFrame = window.requestAnimationFrame(() => focusWhenReady(true));
      }
    });
    const focusWhenReady = (removedOnly = false) => {
      focusFrame = undefined;
      if (!active) return;
      const panel = document.getElementById(panelId);
      if (panel && panel !== observedPanel) {
        observer.disconnect();
        observedPanel = panel;
        observer.observe(panel, { childList: true, subtree: true });
      }
      if (panel?.contains(document.activeElement)) { rememberPanelFocus(); return; }
      if (removedOnly && (!panel || !lostRemovedControl(panel))) return;
      const control = panel?.querySelector<HTMLElement>(FOCUSABLE);
      control?.focus();
      rememberPanelFocus();
      if (active && (!control || document.activeElement !== control)) {
        focusFrame = window.requestAnimationFrame(() => focusWhenReady(removedOnly));
      }
    };
    const focusDialog = window.setTimeout(focusWhenReady, 0);
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = document.getElementById(panelId);
      const controls = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keepFocusInside);
    document.addEventListener('focusin', rememberPanelFocus);
    return () => {
      active = false;
      window.clearTimeout(focusDialog);
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      observer.disconnect();
      document.removeEventListener('keydown', keepFocusInside);
      document.removeEventListener('focusin', rememberPanelFocus);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [panelId, visible]);
}
