import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '../../lib/crypto.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('crypto lib', () => {
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

  it('different encryptions produce different ciphertexts (random IV)', () => {
    const plaintext = 'same text twice';
    const enc1 = encrypt(plaintext, TEST_KEY);
    const enc2 = encrypt(plaintext, TEST_KEY);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1, TEST_KEY)).toBe(plaintext);
    expect(decrypt(enc2, TEST_KEY)).toBe(plaintext);
  });

  it('handles empty string', () => {
    const encrypted = encrypt('', TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe('');
  });

  it('handles unicode characters', () => {
    const plaintext = 'пароль 密码 パスワード';
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypted output is a valid base64 string', () => {
    const encrypted = encrypt('test', TEST_KEY);
    // Should not throw when decoded as base64
    const buf = Buffer.from(encrypted, 'base64');
    // Should contain at least IV (12) + AuthTag (16) + some ciphertext
    expect(buf.length).toBeGreaterThanOrEqual(28);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('sensitive data', TEST_KEY);
    // Flip a byte in the ciphertext portion
    const buf = Buffer.from(encrypted, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });
});
