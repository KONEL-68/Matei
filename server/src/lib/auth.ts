import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 12;

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Hash a plaintext password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Sign a JWT access token (24h expiry).
 */
export function signAccessToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '24h' });
}

/**
 * Sign a JWT refresh token (7d expiry).
 */
export function signRefreshToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

/**
 * Create both access and refresh tokens.
 */
export function createTokenPair(payload: TokenPayload, secret: string): TokenPair {
  return {
    accessToken: signAccessToken(payload, secret),
    refreshToken: signRefreshToken(payload, secret),
  };
}

/**
 * Verify and decode a JWT token. Returns the payload or throws.
 */
export function verifyToken(token: string, secret: string): TokenPayload {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload & TokenPayload;
  return {
    userId: decoded.userId,
    username: decoded.username,
    role: decoded.role,
  };
}
