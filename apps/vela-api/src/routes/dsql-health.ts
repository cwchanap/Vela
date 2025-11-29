import { Hono } from 'hono';
import type { Env } from '../types';
import { checkDsqlHealth } from '../dsql';

const dsqlHealth = new Hono<{ Bindings: Env }>();

dsqlHealth.get('/', async (c) => {
  const result = await checkDsqlHealth();

  if (result.status === 'ok') {
    return c.json(
      {
        status: 'ok',
        details: result.details ?? 'Successfully executed SELECT 1 against Aurora DSQL.',
      },
      200,
    );
  }

  return c.json(
    {
      status: 'error',
      error: result.error ?? 'Failed to execute test query against Aurora DSQL.',
    },
    500,
  );
});

export { dsqlHealth };
