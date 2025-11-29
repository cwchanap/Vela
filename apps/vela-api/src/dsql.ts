import { AuroraDSQLClient } from '@aws/aurora-dsql-node-postgres-connector';
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
    console.error('[DSQL] ' + message);
    return { status: 'error', error: message };
  }

  const user = process.env.AURORA_DB_USER || 'admin';

  const client = new AuroraDSQLClient({
    host,
    user,
    customCredentialsProvider: fromNodeProviderChain(),
  });

  try {
    await client.connect();
    const result: any = await client.query('SELECT 1');
    console.log('[DSQL] Health-check query result', result);
    return {
      status: 'ok',
      details: 'Successfully executed SELECT 1 against Aurora DSQL.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[DSQL] Health-check error', error);
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
