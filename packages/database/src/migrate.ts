import { getPool } from './client';
import { createLogger } from '@kakao-cs-bot/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const logger = createLogger('database:migrate');

async function ensureMigrationsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(500) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id ASC'
  );
  return result.rows.map(r => r.name);
}

async function applyMigration(name: string, sql: string) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    logger.info(`Migration applied: ${name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Migration failed: ${name}`, { error: String(error) });
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const migrationsDir = join(__dirname, '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.includes(file)) {
      logger.info(`Skipping (already applied): ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await applyMigration(file, sql);
    count++;
  }

  if (count === 0) {
    logger.info('No new migrations to apply');
  } else {
    logger.info(`Applied ${count} migration(s)`);
  }
}

