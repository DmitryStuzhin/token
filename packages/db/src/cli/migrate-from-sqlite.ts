import path from 'node:path';
import { loadConfig } from '../../../../server/config.js';
import { PostgresMigrator } from '../migrator.js';
import { createPostgresPool } from '../postgres.js';
import { extractSqlite } from '../sqlite-migration/extract.js';
import { loadPostgres, readExistingMappings } from '../sqlite-migration/load.js';
import { writeMigrationReports } from '../sqlite-migration/report.js';
import { transformDataset } from '../sqlite-migration/transform.js';
import { verifyMigration } from '../sqlite-migration/verify.js';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const source = path.resolve(option('--source') ?? config.databaseFile);
  const reportDirectory = path.resolve(option('--report-dir') ?? 'migration-reports');
  const dryRun = process.argv.includes('--dry-run');
  const verifyOnly = process.argv.includes('--verify-only');
  const startedAt = new Date().toISOString();
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    maxConnections: 1,
    statementTimeoutMs: 120_000,
  });
  try {
    const migrator = new PostgresMigrator(pool, path.join(__dirname, '..', '..', 'migrations'));
    await migrator.up();
    const extracted = extractSqlite(source);
    const existing = await readExistingMappings(pool);
    const transformed = transformDataset(extracted, existing);
    if (dryRun) {
      process.stdout.write(
        `${JSON.stringify(
          {
            dryRun: true,
            source,
            sourceCounts: transformed.sourceCounts,
            targetBatches: Object.fromEntries(
              transformed.batches.map((batch) => [batch.table, batch.rows.length]),
            ),
            warnings: transformed.warnings,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    if (!verifyOnly) await loadPostgres(pool, transformed);
    const report = await verifyMigration(pool, transformed, startedAt);
    const files = await writeMigrationReports(report, reportDirectory);
    process.stdout.write(
      `${JSON.stringify({ success: report.success, report: files }, null, 2)}\n`,
    );
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
