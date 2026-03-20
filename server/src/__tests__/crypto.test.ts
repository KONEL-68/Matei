import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '../lib/crypto.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('crypto', () => {
  it('encrypt then decrypt returns original plaintext', () => {
    const plaintext = 'hello world secret password 123!@#';
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it('works with JSON credentials', () => {
    const creds = JSON.stringify({ username: 'sa', password: 'P@ssw0rd!' });
    const encrypted = encrypt(creds, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(JSON.parse(decrypted)).toEqual({ username: 'sa', password: 'P@ssw0rd!' });
  });

  it('decrypt with wrong key throws error', () => {
    const plaintext = 'secret data';
    const encrypted = encrypt(plaintext, TEST_KEY);
    const wrongKey = crypto.randomBytes(32).toString('hex');
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it('different encryptions of same text produce different ciphertexts (random IV)', () => {
    const plaintext = 'same text twice';
    const enc1 = encrypt(plaintext, TEST_KEY);
    const enc2 = encrypt(plaintext, TEST_KEY);
    expect(enc1).not.toBe(enc2);
    // But both decrypt to the same value
    expect(decrypt(enc1, TEST_KEY)).toBe(plaintext);
    expect(decrypt(enc2, TEST_KEY)).toBe(plaintext);
  });

  it('handles empty string', () => {
    const encrypted = encrypt('', TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe('');
  });

  it('handles unicode', () => {
    const plaintext = 'пароль 密码 パスワード';
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });
});
