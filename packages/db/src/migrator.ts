import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

const MIGRATION_LOCK = 7_421_902_026;

export interface Migration {
  readonly name: string;
  readonly checksum: string;
  readonly up: string;
  readonly down: string;
}

export interface MigrationStatus {
  readonly name: string;
  readonly applied: boolean;
  readonly checksum: string;
  readonly appliedChecksum: string | null;
}

function parseMigration(name: string, source: string): Migration {
  const upMarker = '-- migrate:up';
  const downMarker = '-- migrate:down';
  const upAt = source.indexOf(upMarker);
  const downAt = source.indexOf(downMarker);
  if (upAt < 0 || downAt < 0 || downAt <= upAt) {
    throw new Error(`Migration ${name} must contain migrate:up and migrate:down markers`);
  }
  const up = source.slice(upAt + upMarker.length, downAt).trim();
  const down = source.slice(downAt + downMarker.length).trim();
  return {
    name,
    up,
    down,
    checksum: createHash('sha256').update(up).digest('hex'),
  };
}

export async function loadMigrations(directory: string): Promise<readonly Migration[]> {
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) =>
      parseMigration(name, await fs.readFile(path.join(directory, name), 'utf8')),
    ),
  );
}

async function ensureMigrationTable(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

export class PostgresMigrator {
  public constructor(
    private readonly pool: pg.Pool,
    private readonly migrationsDirectory: string,
  ) {}

  public async status(): Promise<readonly MigrationStatus[]> {
    const client = await this.pool.connect();
    try {
      await ensureMigrationTable(client);
      const applied = await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations ORDER BY name',
      );
      const byName = new Map(applied.rows.map((row) => [row.name, row.checksum]));
      return (await loadMigrations(this.migrationsDirectory)).map((migration) => ({
        name: migration.name,
        checksum: migration.checksum,
        applied: byName.has(migration.name),
        appliedChecksum: byName.get(migration.name) ?? null,
      }));
    } finally {
      client.release();
    }
  }

  public async up(): Promise<readonly string[]> {
    const client = await this.pool.connect();
    const executed: string[] = [];
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await ensureMigrationTable(client);
      const applied = await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations',
      );
      const byName = new Map(applied.rows.map((row) => [row.name, row.checksum]));
      for (const migration of await loadMigrations(this.migrationsDirectory)) {
        const checksum = byName.get(migration.name);
        if (checksum && checksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.name} was modified`);
        }
        if (checksum) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.up);
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
            migration.name,
            migration.checksum,
          ]);
          await client.query('COMMIT');
          executed.push(migration.name);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      return executed;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
      client.release();
    }
  }

  public async down(): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await ensureMigrationTable(client);
      const latest = await client.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
      );
      const name = latest.rows[0]?.name;
      if (!name) return null;
      const migration = (await loadMigrations(this.migrationsDirectory)).find(
        (item) => item.name === name,
      );
      if (!migration) throw new Error(`Migration file ${name} is missing`);
      await client.query('BEGIN');
      try {
        await client.query(migration.down);
        await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
        await client.query('COMMIT');
        return name;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
      client.release();
    }
  }
}
