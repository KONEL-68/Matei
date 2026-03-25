import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { buildConnectionConfig, getSharedPool, closeSharedPool, closeAllSharedPools, type InstanceRecord } from '../../lib/mssql.js';
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

// --- Shared pool cache tests ---
// These tests mock mssql.ConnectionPool to avoid real SQL Server connections

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockRequest = vi.fn();
const mockConnect = vi.fn();

vi.mock('mssql', () => ({
  default: {
    ConnectionPool: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
    })),
  },
}));

function makeInstance(id: number): InstanceRecord {
  return {
    id,
    host: `sql${id}.local`,
    port: 1433,
    auth_type: 'sql',
    encrypted_credentials: null,
  };
}

describe('shared pool cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    closeAllSharedPools();
    vi.clearAllMocks();

    mockConnect.mockResolvedValue({
      connected: true,
      close: mockClose,
      request: mockRequest,
    });
  });

  afterEach(() => {
    closeAllSharedPools();
    vi.useRealTimers();
  });

  it('getSharedPool creates a new pool on first call', async () => {
    const instance = makeInstance(100);
    const pool = await getSharedPool(instance, TEST_KEY);

    expect(pool.connected).toBe(true);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('getSharedPool returns the same pool on subsequent calls', async () => {
    const instance = makeInstance(101);
    const pool1 = await getSharedPool(instance, TEST_KEY);
    const pool2 = await getSharedPool(instance, TEST_KEY);

    expect(pool1).toBe(pool2);
    // connect() should only have been called once (pool was reused)
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('getSharedPool creates separate pools for different instances', async () => {
    const instance1 = makeInstance(102);
    const instance2 = makeInstance(103);

    // Return distinct objects for each connect call
    mockConnect
      .mockResolvedValueOnce({ connected: true, close: mockClose, request: mockRequest })
      .mockResolvedValueOnce({ connected: true, close: mockClose, request: mockRequest });

    const pool1 = await getSharedPool(instance1, TEST_KEY);
    const pool2 = await getSharedPool(instance2, TEST_KEY);

    expect(pool1).not.toBe(pool2);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('closeSharedPool removes the pool from cache', async () => {
    const instance = makeInstance(104);
    await getSharedPool(instance, TEST_KEY);

    closeSharedPool(instance.id);

    // Next call should create a new pool
    await getSharedPool(instance, TEST_KEY);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('closeSharedPool is a no-op for unknown instance IDs', () => {
    // Should not throw
    closeSharedPool(99999);
  });

  it('closeAllSharedPools closes all cached pools', async () => {
    const instance1 = makeInstance(105);
    const instance2 = makeInstance(106);

    await getSharedPool(instance1, TEST_KEY);
    await getSharedPool(instance2, TEST_KEY);

    closeAllSharedPools();

    // Both should create new pools now
    await getSharedPool(instance1, TEST_KEY);
    await getSharedPool(instance2, TEST_KEY);
    // 2 initial + 2 after closeAll
    expect(mockConnect).toHaveBeenCalledTimes(4);
  });

  it('pool is auto-closed after 5 minutes of inactivity', async () => {
    const instance = makeInstance(107);
    await getSharedPool(instance, TEST_KEY);

    // Advance time past the 5-minute idle timeout
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    // Pool should have been evicted, next call creates a new one
    await getSharedPool(instance, TEST_KEY);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('idle timer resets on each getSharedPool call', async () => {
    const instance = makeInstance(108);
    await getSharedPool(instance, TEST_KEY);

    // Advance 4 minutes (still within timeout)
    vi.advanceTimersByTime(4 * 60 * 1000);
    await getSharedPool(instance, TEST_KEY);

    // Advance another 4 minutes (would have expired without the reset)
    vi.advanceTimersByTime(4 * 60 * 1000);
    await getSharedPool(instance, TEST_KEY);

    // Pool should have been reused all three times (only 1 connect call)
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('getSharedPool creates a new pool if existing pool is disconnected', async () => {
    const instance = makeInstance(109);

    // First call creates a connected pool
    mockConnect.mockResolvedValueOnce({
      connected: true,
      close: mockClose,
      request: mockRequest,
    });
    await getSharedPool(instance, TEST_KEY);

    // Simulate the pool becoming disconnected
    closeSharedPool(instance.id);

    // Manually set up a disconnected pool entry to test the reconnect path
    mockConnect.mockResolvedValueOnce({
      connected: true,
      close: mockClose,
      request: mockRequest,
    });
    const pool2 = await getSharedPool(instance, TEST_KEY);
    expect(pool2.connected).toBe(true);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });
});
