import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthState } from '../store/useGameStore';
import { ROOM_CODE_PATTERN } from '@zuychin-arcade/types';

const WEB_AUTH_KEY = 'za:auth';
const NATIVE_AUTH_KEY = 'za.auth';
const NAME_KEY = 'za:displayName';
let authMutations: Promise<void> = Promise.resolve();

function mutateAuth<T>(operation: () => Promise<T>): Promise<T> {
  const pending = authMutations.then(operation);
  authMutations = pending.then(() => undefined, () => undefined);
  return pending;
}

function webSessionStorage(): Storage {
  if (typeof globalThis.sessionStorage === 'undefined') {
    throw new Error('Session storage is unavailable in this browser.');
  }
  return globalThis.sessionStorage;
}

async function writeAuth(auth: AuthState): Promise<void> {
  if (Platform.OS === 'web') {
    webSessionStorage().setItem(WEB_AUTH_KEY, JSON.stringify(auth));
    return;
  }
  await SecureStore.setItemAsync(NATIVE_AUTH_KEY, JSON.stringify(auth), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function removeAuth(): Promise<void> {
  if (Platform.OS === 'web') webSessionStorage().removeItem(WEB_AUTH_KEY);
  else await SecureStore.deleteItemAsync(NATIVE_AUTH_KEY);
}

export function saveAuth(auth: AuthState): Promise<void> {
  return mutateAuth(() => writeAuth(auth));
}

export function saveAuthIfCurrent(auth: AuthState, isCurrent: () => boolean): Promise<boolean> {
  return mutateAuth(async () => {
    if (!isCurrent()) return false;
    await writeAuth(auth);
    if (isCurrent()) return true;
    await removeAuth();
    return false;
  });
}

export function clearAuthIfMatches(token: string): Promise<void> {
  return mutateAuth(async () => {
    const raw = Platform.OS === 'web'
      ? webSessionStorage().getItem(WEB_AUTH_KEY)
      : await SecureStore.getItemAsync(NATIVE_AUTH_KEY);
    if (!raw) return;
    let saved: unknown;
    try { saved = JSON.parse(raw); } catch { return; }
    if (saved && typeof saved === 'object' && 'token' in saved && saved.token === token) await removeAuth();
  });
}

export function loadAuth(): Promise<AuthState | null> {
  return mutateAuth(async () => {
    const raw = Platform.OS === 'web'
      ? webSessionStorage().getItem(WEB_AUTH_KEY)
      : await SecureStore.getItemAsync(NATIVE_AUTH_KEY);
    if (!raw) return null;

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      await removeAuth();
      return null;
    }
    if (!isAuthState(value)) {
      await removeAuth();
      return null;
    }
    return value;
  });
}

export function clearAuth(): Promise<void> {
  return mutateAuth(removeAuth);
}

export async function saveDisplayName(name: string): Promise<void> {
  await AsyncStorage.setItem(NAME_KEY, name);
}

export async function loadDisplayName(): Promise<string | null> {
  return AsyncStorage.getItem(NAME_KEY);
}

function isAuthState(value: unknown): value is AuthState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const auth = value as Record<string, unknown>;
  return typeof auth.token === 'string'
    && auth.token.length > 0
    && auth.token.length <= 4096
    && typeof auth.playerId === 'string'
    && auth.playerId.length > 0
    && auth.playerId.length <= 128
    && typeof auth.displayName === 'string'
    && auth.displayName.trim().length > 0
    && Array.from(auth.displayName).length <= 20
    && typeof auth.roomCode === 'string'
    && ROOM_CODE_PATTERN.test(auth.roomCode);
}
