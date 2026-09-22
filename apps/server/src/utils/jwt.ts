import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@zuychin-arcade/types';
import { isInsecureLocalDev } from './securityConfig.js';

const DEVELOPMENT_SECRET = 'dev-secret-do-not-use-in-prod';
export const JWT_ISSUER = 'zuychin-arcade-server';
export const JWT_AUDIENCE = 'zuychin-arcade-room-session';
const EXPIRY = '24h';

export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configuredSecret = env.JWT_SECRET?.trim();
  if (configuredSecret) {
    if (Buffer.byteLength(configuredSecret, 'utf8') < 32) {
      throw new Error('JWT_SECRET must contain at least 32 bytes');
    }
    return configuredSecret;
  }
  if (isInsecureLocalDev(env)) return DEVELOPMENT_SECRET;
  throw new Error('JWT_SECRET is required unless ARCADE_INSECURE_LOCAL_DEV=true');
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.playerId === 'string'
    && payload.playerId.length > 0
    && typeof payload.roomCode === 'string'
    && payload.roomCode.length > 0
    && typeof payload.displayName === 'string'
    && typeof payload.isHost === 'boolean'
    && Number.isSafeInteger(payload.iat)
    && Number.isSafeInteger(payload.exp);
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, resolveJwtSecret(), {
    algorithm: 'HS256',
    audience: JWT_AUDIENCE,
    expiresIn: EXPIRY,
    issuer: JWT_ISSUER,
  });
}

export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, resolveJwtSecret(), {
    algorithms: ['HS256'],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  });
  if (!isJwtPayload(payload)) throw new Error('Invalid token payload');
  return payload;
}
