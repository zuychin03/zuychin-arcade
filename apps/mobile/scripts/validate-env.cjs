const rawUrl = process.env.EXPO_PUBLIC_SERVER_URL?.trim();
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

if (!rawUrl) {
  throw new Error('EXPO_PUBLIC_SERVER_URL is required.');
}

let parsedUrl;
try {
  parsedUrl = new URL(rawUrl);
} catch {
  throw new Error('EXPO_PUBLIC_SERVER_URL must be a valid absolute HTTP(S) URL.');
}

if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
  throw new Error('EXPO_PUBLIC_SERVER_URL must use HTTP or HTTPS.');
}
if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
  throw new Error('EXPO_PUBLIC_SERVER_URL must not contain credentials, query parameters, or a fragment.');
}
if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
  throw new Error('EXPO_PUBLIC_SERVER_URL must be an origin without a path.');
}
if (isProduction && parsedUrl.protocol !== 'https:') {
  throw new Error('EXPO_PUBLIC_SERVER_URL must use HTTPS in production builds.');
}

console.log(`Validated EXPO_PUBLIC_SERVER_URL (${parsedUrl.origin}).`);
