import { describe, test, expect, vi, beforeEach } from 'bun:test';

// Mock the Aurora DSQL connector before importing
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();
const mockAuroraDSQLClient = vi.fn<
  [Record<string, unknown>],
  { connect: typeof mockConnect; query: typeof mockQuery; end: typeof mockEnd }
>(() => ({
  connect: mockConnect,
  query: mockQuery,
  end: mockEnd,
}));

vi.mock('@aws/aurora-dsql-node-postgres-connector', () => ({
  AuroraDSQLClient: mockAuroraDSQLClient,
}));

vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: vi.fn(() => 'mock-credential-provider'),
}));

const { checkDsqlHealth } = await import('../src/dsql');

describe('checkDsqlHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnd.mockResolvedValue(undefined);
  });

  test('returns error status when AURORA_DB_ENDPOINT is not set', async () => {
    const originalEnv = process.env.AURORA_DB_ENDPOINT;
    delete process.env.AURORA_DB_ENDPOINT;

    try {
      const result = await checkDsqlHealth();
      expect(result.status).toBe('error');
      expect(result.error).toContain('AURORA_DB_ENDPOINT is not configured');
    } finally {
      if (originalEnv !== undefined) {
        process.env.AURORA_DB_ENDPOINT = originalEnv;
      }
    }
  });

  test('returns ok status when SELECT 1 succeeds', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    try {
      const result = await checkDsqlHealth();
      expect(result.status).toBe('ok');
      expect(result.details).toContain('SELECT 1');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('returns error status when query fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockRejectedValueOnce(new Error('Query execution failed'));

    try {
      const result = await checkDsqlHealth();
      expect(result.status).toBe('error');
      expect(result.error).toContain('Query execution failed');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('returns error status when connect fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

    try {
      const result = await checkDsqlHealth();
      expect(result.status).toBe('error');
      expect(result.error).toContain('Connection refused');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('calls client.end() in finally block even when query fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockRejectedValueOnce(new Error('Query failed'));

    try {
      await checkDsqlHealth();
      expect(mockEnd).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('calls client.end() even when connect fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

    try {
      await checkDsqlHealth();
      expect(mockEnd).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('uses AURORA_DB_USER env var when set', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    process.env.AURORA_DB_USER = 'custom-user';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    try {
      await checkDsqlHealth();
      const constructorArgs = mockAuroraDSQLClient.mock.calls[0][0];
      expect(constructorArgs.user).toBe('custom-user');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
      delete process.env.AURORA_DB_USER;
    }
  });

  test('defaults AURORA_DB_USER to admin when not set', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    delete process.env.AURORA_DB_USER;
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    try {
      await checkDsqlHealth();
      const constructorArgs = mockAuroraDSQLClient.mock.calls[0][0];
      expect(constructorArgs.user).toBe('admin');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('handles non-Error thrown values gracefully', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockRejectedValueOnce('string error');

    try {
      const result = await checkDsqlHealth();
      expect(result.status).toBe('error');
      expect(result.error).toBe('string error');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });

  test('handles end() failure gracefully without propagating error', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockEnd.mockRejectedValueOnce(new Error('End failed'));

    try {
      const result = await checkDsqlHealth();
      // Should still return ok - end() failure should not propagate
      expect(result.status).toBe('ok');
    } finally {
      delete process.env.AURORA_DB_ENDPOINT;
    }
  });
});
