import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// Return COUNT/SUM (bigint) and NUMERIC money columns as JavaScript numbers.
// Safe here: quantities and Ghana cedi amounts are far below 2^53.
types.setTypeParser(20, (v) => parseInt(v, 10)); // int8
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric

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
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.get<string>('DATABASE_URL'),
      max: 10,
      options: '-c search_path=ims,public',
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

  async onModuleDestroy() {
    await this.pool.end();
  }
}
