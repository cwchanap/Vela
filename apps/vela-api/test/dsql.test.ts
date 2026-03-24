import { describe, test, expect, vi, beforeEach, afterEach } from 'bun:test';

// Mock the Aurora DSQL connector before importing
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();
const mockAuroraDSQLClient = vi.fn<
  // eslint-disable-next-line no-unused-vars
  (config: Record<string, unknown>) => {
    connect: typeof mockConnect;
    query: typeof mockQuery;
    end: typeof mockEnd;
  }
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
  let originalEndpoint: string | undefined;
  let originalUser: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnd.mockResolvedValue(undefined);
    originalEndpoint = process.env.AURORA_DB_ENDPOINT;
    originalUser = process.env.AURORA_DB_USER;
  });

  afterEach(() => {
    if (originalEndpoint !== undefined) {
      process.env.AURORA_DB_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.AURORA_DB_ENDPOINT;
    }
    if (originalUser !== undefined) {
      process.env.AURORA_DB_USER = originalUser;
    } else {
      delete process.env.AURORA_DB_USER;
    }
  });

  test('returns error status when AURORA_DB_ENDPOINT is not set', async () => {
    delete process.env.AURORA_DB_ENDPOINT;
    const result = await checkDsqlHealth();
    expect(result.status).toBe('error');
    expect(result.error).toContain('AURORA_DB_ENDPOINT is not configured');
  });

  test('returns ok status when SELECT 1 succeeds', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const result = await checkDsqlHealth();
    expect(result.status).toBe('ok');
    expect(result.details).toContain('SELECT 1');
  });

  test('returns error status when query fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockRejectedValueOnce(new Error('Query execution failed'));
    const result = await checkDsqlHealth();
    expect(result.status).toBe('error');
    expect(result.error).toContain('Query execution failed');
  });

  test('returns error status when connect fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await checkDsqlHealth();
    expect(result.status).toBe('error');
    expect(result.error).toContain('Connection refused');
  });

  test('calls client.end() in finally block even when query fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockRejectedValueOnce(new Error('Query failed'));
    await checkDsqlHealth();
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  test('calls client.end() even when connect fails', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
    await checkDsqlHealth();
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  test('uses AURORA_DB_USER env var when set', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    process.env.AURORA_DB_USER = 'custom-user';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await checkDsqlHealth();
    const constructorArgs = mockAuroraDSQLClient.mock.calls[0][0];
    expect(constructorArgs.user).toBe('custom-user');
  });

  test('defaults AURORA_DB_USER to admin when not set', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    delete process.env.AURORA_DB_USER;
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await checkDsqlHealth();
    const constructorArgs = mockAuroraDSQLClient.mock.calls[0][0];
    expect(constructorArgs.user).toBe('admin');
  });

  test('handles non-Error thrown values gracefully', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockRejectedValueOnce('string error');
    const result = await checkDsqlHealth();
    expect(result.status).toBe('error');
    expect(result.error).toBe('string error');
  });

  test('handles end() failure gracefully without propagating error', async () => {
    process.env.AURORA_DB_ENDPOINT = 'test-db.example.com';
    mockConnect.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockEnd.mockRejectedValueOnce(new Error('End failed'));
    const result = await checkDsqlHealth();
    // Should still return ok - end() failure should not propagate
    expect(result.status).toBe('ok');
  });
});
