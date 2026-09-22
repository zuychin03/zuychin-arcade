import { isInsecureLocalDev } from './securityConfig.js';

function normaliseConfiguredOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid origin in ARCADE_ALLOWED_ORIGINS');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search
    || url.hash
  ) {
    throw new Error('ARCADE_ALLOWED_ORIGINS entries must be HTTP(S) origins without paths, credentials, queries or fragments');
  }
  return url.origin;
}

function normaliseRequestOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackRequestOrigin(value: string): boolean {
  const normalised = normaliseRequestOrigin(value);
  if (!normalised) return false;
  const hostname = new URL(normalised).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function configuredCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const values = (env.ARCADE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normaliseConfiguredOrigin);
  if (!isInsecureLocalDev(env) && values.length === 0) {
    throw new Error('ARCADE_ALLOWED_ORIGINS is required unless ARCADE_INSECURE_LOCAL_DEV=true');
  }
  return new Set(values);
}

export function createCorsOriginValidator(
  env: NodeJS.ProcessEnv = process.env,
): (origin: string | undefined) => boolean {
  const configured = configuredCorsOrigins(env);
  const insecureLocalDev = isInsecureLocalDev(env);
  return (origin) => {
    if (!origin) return true;
    if (insecureLocalDev) return isLoopbackRequestOrigin(origin);
    const normalised = normaliseRequestOrigin(origin);
    return normalised !== null && configured.has(normalised);
  };
}
