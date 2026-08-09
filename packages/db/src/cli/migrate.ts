import path from 'node:path';
import { loadConfig } from '../../../../server/config.js';
import { PostgresMigrator } from '../migrator.js';
import { createPostgresPool } from '../postgres.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    maxConnections: 1,
    statementTimeoutMs: config.databaseStatementTimeoutMs,
  });
  const migrator = new PostgresMigrator(pool, path.join(__dirname, '..', '..', 'migrations'));
  try {
    const command = process.argv[2] ?? 'status';
    if (command === 'up') {
      process.stdout.write(`${JSON.stringify({ migrated: await migrator.up() }, null, 2)}\n`);
    } else if (command === 'down') {
      process.stdout.write(`${JSON.stringify({ rolledBack: await migrator.down() }, null, 2)}\n`);
    } else if (command === 'status') {
      process.stdout.write(`${JSON.stringify(await migrator.status(), null, 2)}\n`);
    } else {
      throw new Error(`Unknown migration command: ${command}`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
