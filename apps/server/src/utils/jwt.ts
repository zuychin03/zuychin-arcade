import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@zuychin-arcade/types';

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';
if (!process.env.JWT_SECRET) {
  console.warn('[jwt] JWT_SECRET not set — using insecure dev fallback');
}
const EXPIRY = '24h';

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}
