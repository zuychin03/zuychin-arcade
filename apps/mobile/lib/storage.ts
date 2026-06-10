import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthState } from '../store/useGameStore';

const AUTH_KEY = 'za:auth';
const NAME_KEY = 'za:displayName';

export async function saveAuth(auth: AuthState): Promise<void> {
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export async function loadAuth(): Promise<AuthState | null> {
  const raw = await AsyncStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export async function clearAuth(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY);
}

export async function saveDisplayName(name: string): Promise<void> {
  await AsyncStorage.setItem(NAME_KEY, name);
}

export async function loadDisplayName(): Promise<string | null> {
  return AsyncStorage.getItem(NAME_KEY);
}
