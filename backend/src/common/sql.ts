import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * Builds and runs "UPDATE table SET a=$1, b=$2 WHERE key=$n RETURNING *"
 * from only the fields that were sent. Column names come from an
 * allow-list, never from the request, so this is safe from SQL injection;
 * values are always passed as parameters.
 */
export async function updateRow(
  client: PoolClient,
  table: string,
  keyColumn: string,
  id: number,
  data: Record<string, unknown>,
  allowedColumns: readonly string[],
) {
  const entries = Object.entries(data).filter(([k, v]) => allowedColumns.includes(k) && v !== undefined);
  if (entries.length === 0) throw new BadRequestException('Nothing to update');

  const sets = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values = entries.map(([, v]) => v);
  const { rows } = await client.query(
    `UPDATE ${table} SET ${sets} WHERE ${keyColumn} = $${values.length + 1} RETURNING *`,
    [...values, id],
  );
  if (!rows[0]) throw new NotFoundException(`${table.replace('_', ' ')} ${id} not found`);
  return rows[0];
}

/** Builds and runs "INSERT INTO table (cols) VALUES (...) RETURNING *" from an allow-list. */
export async function insertRow(
  client: PoolClient,
  table: string,
  data: Record<string, unknown>,
  allowedColumns: readonly string[],
) {
  const entries = Object.entries(data).filter(([k, v]) => allowedColumns.includes(k) && v !== undefined);
  const cols = entries.map(([k]) => k).join(', ');
  const params = entries.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING *`,
    entries.map(([, v]) => v),
  );
  return rows[0];
}
