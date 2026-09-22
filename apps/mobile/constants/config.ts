const rawUrl = process.env.EXPO_PUBLIC_SERVER_URL?.trim();

if (!rawUrl) {
  throw new Error('EXPO_PUBLIC_SERVER_URL is required. Add it to apps/mobile/.env for development and to the EAS environment for builds.');
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(rawUrl);
} catch {
  throw new Error('EXPO_PUBLIC_SERVER_URL must be a valid absolute HTTP(S) URL.');
}

if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
  throw new Error('EXPO_PUBLIC_SERVER_URL must use HTTP or HTTPS.');
}
if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
  throw new Error('EXPO_PUBLIC_SERVER_URL must not contain credentials, query parameters, or a fragment.');
}
if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
  throw new Error('EXPO_PUBLIC_SERVER_URL must be an origin without a path.');
}

const isProduction = typeof __DEV__ === 'undefined'
  ? process.env.NODE_ENV === 'production'
  : !__DEV__;
if (isProduction && parsedUrl.protocol !== 'https:') {
  throw new Error('EXPO_PUBLIC_SERVER_URL must use HTTPS in production builds.');
}

export const SERVER_URL = parsedUrl.origin;
