// Applies migrations/*.sql in name order, each in its own transaction, recording what ran.
// Usage: npm run migrate   (reads DATABASE_URL from .env)
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const main = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add your Neon connection string to .env first.');
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    const { rows } = await client.query('select name from schema_migrations');
    const applied = new Set(rows.map(r => r.name));

    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    const pending = files.filter(f => !applied.has(f));
    if (pending.length === 0) {
      console.log('Database is up to date.');
      return;
    }

    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${file} failed, nothing from it was applied: ${error.message}`);
      }
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
