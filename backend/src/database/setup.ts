import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/** The repository's database/ folder (works from src/ with ts-node and from dist/). */
export const DATABASE_DIR = join(__dirname, '..', '..', '..', 'database');

/** Every numbered script, in order: 01_schema.sql, 02_sample_data.sql, 03_..., 04_... */
export function setupScripts(): string[] {
  if (!existsSync(DATABASE_DIR)) throw new Error(`Database scripts not found in ${DATABASE_DIR}`);
  return readdirSync(DATABASE_DIR)
    .filter((f) => /^\d{2}_.*\.sql$/.test(f))
    .sort();
}

/**
 * Builds the whole database (schema + sample data + additions) by running
 * the numbered scripts. 01_schema.sql starts with DROP SCHEMA ims CASCADE,
 * so this also resets an existing database.
 *
 * Uses an advisory lock so two app instances starting together can't both run it.
 */
export async function buildDatabase(pool: Pool, log: (m: string) => void = console.log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727270)');
    for (const file of setupScripts()) {
      log(`Running ${file}`);
      await client.query(readFileSync(join(DATABASE_DIR, file), 'utf8'));
    }
    // Make "ims" the default schema for this database user, even on pooled connections.
    await client.query('ALTER ROLE CURRENT_USER SET search_path = ims, public');
    log('Database ready');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727270)').catch(() => undefined);
    client.release();
  }
}

/** True if the ims schema already has its tables. */
export async function databaseExists(pool: Pool) {
  const { rows } = await pool.query(`SELECT to_regclass('ims.product') IS NOT NULL AS ok`);
  return rows[0].ok as boolean;
}

/**
 * Command line:  npm run db:setup          (build only if empty)
 *                npm run db:reset          (drop and rebuild with fresh sample data)
 * Reads DATABASE_URL from the environment or backend/.env.
 */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: join(__dirname, '..', '..', '.env') });
  const reset = process.argv.includes('--reset');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  (async () => {
    if (!reset && (await databaseExists(pool))) {
      console.log('Database already set up. Use "npm run db:reset" to rebuild it with fresh sample data.');
    } else {
      await buildDatabase(pool);
    }
    await pool.end();
  })().catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
}
