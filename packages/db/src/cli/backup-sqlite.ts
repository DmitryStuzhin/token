import path from 'node:path';
import { loadConfig } from '../../../../server/config.js';
import { createSqliteBackup } from '../sqlite-migration/backup.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await createSqliteBackup(
    config.databaseFile,
    path.resolve(process.argv[2] ?? 'backups'),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
