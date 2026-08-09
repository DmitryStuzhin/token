import { loadConfig } from '../../../../server/config.js';
import { createPostgresPool } from '../postgres.js';
import { rebuildAndVerifyReadModels } from '../read-models.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    maxConnections: 1,
    statementTimeoutMs: 120_000,
  });
  try {
    const report = await rebuildAndVerifyReadModels(pool);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.success) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
