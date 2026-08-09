import type pg from 'pg';
import type { TargetBatch, TransformedDataset } from './types.js';

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

async function loadBatch(client: pg.PoolClient, batch: TargetBatch): Promise<number> {
  if (batch.rows.length === 0) return 0;
  let loaded = 0;
  const chunkSize = 200;
  for (let offset = 0; offset < batch.rows.length; offset += chunkSize) {
    const rows = batch.rows.slice(offset, offset + chunkSize);
    const columns = Object.keys(rows[0] ?? {});
    if (columns.length === 0) continue;
    for (const row of rows) {
      if (columns.some((column) => !Object.hasOwn(row, column))) {
        throw new Error(`Inconsistent columns in ${batch.table} migration batch`);
      }
    }
    const values: unknown[] = [];
    const tuples = rows.map((row) => {
      const parameters = columns.map((column) => {
        const value = row[column];
        values.push(
          value !== null && typeof value === 'object' && !(value instanceof Date)
            ? JSON.stringify(value)
            : value,
        );
        return `$${String(values.length)}`;
      });
      return `(${parameters.join(',')})`;
    });
    const conflict = batch.conflictColumns.length
      ? `ON CONFLICT (${batch.conflictColumns.map(quoteIdentifier).join(',')}) DO NOTHING`
      : '';
    const result = await client.query(
      `INSERT INTO ${quoteIdentifier(batch.table)} (${columns.map(quoteIdentifier).join(',')})
       VALUES ${tuples.join(',')} ${conflict}`,
      values,
    );
    loaded += result.rowCount ?? 0;
  }
  return loaded;
}

export async function loadPostgres(
  pool: pg.Pool,
  dataset: TransformedDataset,
): Promise<Readonly<Record<string, number>>> {
  const client = await pool.connect();
  const counts: Record<string, number> = {};
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    for (const batch of dataset.batches) {
      counts[batch.table] = await loadBatch(client, batch);
    }
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readExistingMappings(pool: pg.Pool): Promise<ReadonlyMap<string, string>> {
  const result = await pool.query<{ source_table: string; legacy_id: string; target_id: string }>(
    'SELECT source_table, legacy_id, target_id::text FROM legacy_id_map',
  );
  return new Map(
    result.rows.map((row) => [`${row.source_table}\u0000${row.legacy_id}`, row.target_id]),
  );
}
