import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildConnectionConfig, type InstanceRecord } from '../../lib/mssql.js';
import { encrypt } from '../../lib/crypto.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('buildConnectionConfig', () => {
  it('builds config with SQL auth credentials', () => {
    const creds = JSON.stringify({ username: 'sa', password: 'P@ssw0rd!' });
    const encrypted = encrypt(creds, TEST_KEY);

    const instance: InstanceRecord = {
      id: 1,
      host: 'sql01.local',
      port: 1433,
      auth_type: 'sql',
      encrypted_credentials: encrypted,
    };

    const config = buildConnectionConfig(instance, TEST_KEY);

    expect(config.server).toBe('sql01.local');
    expect(config.port).toBe(1433);
    expect(config.user).toBe('sa');
    expect(config.password).toBe('P@ssw0rd!');
    expect(config.options?.encrypt).toBe(true);
    expect(config.options?.trustServerCertificate).toBe(true);
    expect(config.options?.connectTimeout).toBe(5000);
    expect(config.options?.requestTimeout).toBe(10000);
    expect(config.options?.appName).toBe('Matei Monitor');
  });

  it('builds config for Windows auth', () => {
    const instance: InstanceRecord = {
      id: 2,
      host: 'sql02.local',
      port: 1433,
      auth_type: 'windows',
      encrypted_credentials: null,
    };

    const config = buildConnectionConfig(instance, TEST_KEY);

    expect(config.server).toBe('sql02.local');
    expect(config.options?.trustedConnection).toBe(true);
    expect(config.user).toBeUndefined();
    expect(config.password).toBeUndefined();
  });

  it('builds config without credentials when encrypted_credentials is null', () => {
    const instance: InstanceRecord = {
      id: 3,
      host: 'sql03.local',
      port: 1434,
      auth_type: 'sql',
      encrypted_credentials: null,
    };

    const config = buildConnectionConfig(instance, TEST_KEY);

    expect(config.server).toBe('sql03.local');
    expect(config.port).toBe(1434);
    expect(config.user).toBeUndefined();
    expect(config.password).toBeUndefined();
  });

  it('uses custom port', () => {
    const instance: InstanceRecord = {
      id: 4,
      host: 'sql-custom.local',
      port: 2433,
      auth_type: 'sql',
      encrypted_credentials: null,
    };

    const config = buildConnectionConfig(instance, TEST_KEY);
    expect(config.port).toBe(2433);
  });

  it('throws on invalid encrypted credentials', () => {
    const instance: InstanceRecord = {
      id: 5,
      host: 'sql05.local',
      port: 1433,
      auth_type: 'sql',
      encrypted_credentials: 'not-valid-encrypted-data',
    };

    expect(() => buildConnectionConfig(instance, TEST_KEY)).toThrow();
  });
});
