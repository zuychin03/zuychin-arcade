const rawUrl = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:3001';
export const SERVER_URL = rawUrl.replace(/\/+$/, '');
