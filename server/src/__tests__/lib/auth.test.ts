import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signAccessToken, verifyToken, createTokenPair } from '../../lib/auth.js';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-secret-key-for-unit-tests-only';

describe('auth - password hashing', () => {
  it('hash + verify roundtrip succeeds', async () => {
    const password = 'MySecureP@ssw0rd';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$2b$')).toBe(true);

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('wrong password fails verification', async () => {
    const hash = await hashPassword('correct-password');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });

  it('different hashes for same password (salt)', async () => {
    const password = 'test123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
    // Both should still verify
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });
});

describe('auth - JWT tokens', () => {
  const payload = { userId: 1, username: 'admin', role: 'admin' };

  it('sign + verify roundtrip succeeds', () => {
    const token = signAccessToken(payload, TEST_SECRET);
    const decoded = verifyToken(token, TEST_SECRET);

    expect(decoded.userId).toBe(1);
    expect(decoded.username).toBe('admin');
    expect(decoded.role).toBe('admin');
  });

  it('createTokenPair returns both access and refresh tokens', () => {
    const pair = createTokenPair(payload, TEST_SECRET);

    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.accessToken).not.toBe(pair.refreshToken);

    // Both should be verifiable
    const access = verifyToken(pair.accessToken, TEST_SECRET);
    const refresh = verifyToken(pair.refreshToken, TEST_SECRET);
    expect(access.userId).toBe(1);
    expect(refresh.userId).toBe(1);
  });

  it('expired token returns error', () => {
    // Create a token that's already expired
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '0s' });

    expect(() => verifyToken(token, TEST_SECRET)).toThrow();
  });

  it('token with wrong secret fails verification', () => {
    const token = signAccessToken(payload, TEST_SECRET);
    expect(() => verifyToken(token, 'wrong-secret')).toThrow();
  });

  it('malformed token fails verification', () => {
    expect(() => verifyToken('not-a-jwt', TEST_SECRET)).toThrow();
  });
});
