import pg from 'pg';
import { HttpError } from './errors.js';

// bigint (paise) as a JS number; amounts stay far below Number.MAX_SAFE_INTEGER
pg.types.setTypeParser(pg.types.builtins.INT8, value => Number(value));
// Keep `date` columns as 'YYYY-MM-DD' strings; parsing them into Date objects shifts the day by timezone
pg.types.setTypeParser(pg.types.builtins.DATE, value => value);

let pool;

// Created on first use, so the Notion-only routes keep working without DATABASE_URL.
// Use Neon's pooled connection string on Vercel: every serverless instance opens its own pool.
const getPool = () => {
  if (!process.env.DATABASE_URL) {
    throw new HttpError(503, 'The ledger database is not configured yet.');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
    });
    pool.on('error', (error) => console.error('Idle database client error:', error));
  }
  return pool;
};

export const query = (text, params) => getPool().query(text, params);

// Runs fn(client) inside a transaction; rolls back if it throws
export const withTransaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
