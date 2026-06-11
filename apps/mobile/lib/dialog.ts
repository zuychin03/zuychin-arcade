import { create } from 'zustand';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface DialogConfig {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

interface DialogStore {
  dialog: DialogConfig | null;
  show: (dialog: DialogConfig) => void;
  hide: () => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  dialog: null,
  show: (dialog) => set({ dialog }),
  hide: () => set({ dialog: null }),
}));

/**
 * Cross-platform replacement for Alert.alert (a no-op on react-native-web).
 * Rendered by <ArcadeDialogHost /> in the root layout.
 */
export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  useDialogStore.getState().show({
    title,
    message,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
  });
}
