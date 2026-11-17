import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { buildDatabase, databaseExists } from './setup';

// Return COUNT/SUM (bigint) and NUMERIC money columns as JavaScript numbers.
// Safe here: quantities and Ghana cedi amounts are far below 2^53.
types.setTypeParser(20, (v) => parseInt(v, 10)); // int8
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
// Keep DATE columns as 'YYYY-MM-DD' strings: no time-zone shifts on expiry dates.
types.setTypeParser(1082, (v) => v); // date

/**
 * Thin wrapper around the node-postgres connection pool.
 *
 * We use plain SQL (no ORM) on purpose: the database design from
 * Assignment 7 - constraints, views, triggers and functions - does the
 * heavy lifting, and the SQL stays visible for the report and the Q&A.
 *
 * Every connection uses the "ims" schema.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger('Database');

  constructor(private readonly config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.get<string>('DATABASE_URL'),
      max: 10,
    });
    // Every connection works in the "ims" schema. (Set per connection rather than as a
    // startup option, because hosted Postgres poolers such as Neon's reject startup options.)
    this.pool.on('connect', (client) => {
      client.query('SET search_path TO ims, public').catch(() => undefined);
    });
  }

  /** Run one query outside a transaction (fine for reads). */
  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  /** Return the first row or null. */
  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Run several statements as ONE transaction: either all succeed or none do.
   * userId is stored in the session setting app.user_id so the audit
   * triggers (03_phase0_additions.sql) record who made each change.
   */
  async transaction<T>(userId: number | null, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (userId) {
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(userId)]);
      }
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Hosting convenience: with DB_AUTO_SETUP=true, an empty database is built
   * automatically (schema + sample data) the first time the API starts.
   * An existing database is never touched.
   */
  async onModuleInit() {
    if (this.config.get('DB_AUTO_SETUP') !== 'true') return;
    if (await databaseExists(this.pool)) return;
    this.logger.log('Empty database: building schema and sample data');
    await buildDatabase(this.pool, (m) => this.logger.log(m));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
