import { AuroraDSQLClient } from '@aws/aurora-dsql-node-postgres-connector';
import type { Client } from 'pg';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

export interface DsqlHealthResult {
  status: 'ok' | 'error';
  details?: string;
  error?: string;
}

export async function checkDsqlHealth(): Promise<DsqlHealthResult> {
  const host = process.env.AURORA_DB_ENDPOINT;
  if (!host) {
    const message = 'AURORA_DB_ENDPOINT is not configured';
    console.error('[DSQL] Health-check configuration error', {
      message,
      env: {
        AURORA_DB_ENDPOINT: process.env.AURORA_DB_ENDPOINT ? 'present' : 'missing',
        AURORA_DB_CLUSTER_ARN: process.env.AURORA_DB_CLUSTER_ARN ? 'present' : 'missing',
        AURORA_DB_USER: process.env.AURORA_DB_USER ?? 'not set',
      },
    });
    return { status: 'error', error: message };
  }

  const user = process.env.AURORA_DB_USER || 'admin';

  const client = new AuroraDSQLClient({
    host,
    user,
    customCredentialsProvider: fromNodeProviderChain(),
    connectionTimeoutMillis: 5_000,
  } as unknown as ConstructorParameters<typeof AuroraDSQLClient>[0]) as Client;

  try {
    await client.connect();
    const result = await client.query('SELECT 1');
    console.log('[DSQL] Health-check success', {
      host,
      user,
      rows: Array.isArray(result?.rows) ? result.rows.length : undefined,
    });
    return {
      status: 'ok',
      details: 'Successfully executed SELECT 1 against Aurora DSQL.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[DSQL] Health-check error', {
      message,
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      status: 'error',
      error: message,
    };
  } finally {
    try {
      await client.end();
    } catch (e) {
      console.error('[DSQL] Error closing client', e);
    }
  }
}
