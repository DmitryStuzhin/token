import { verifySqliteBackup } from '../sqlite-migration/backup.js';

async function main(): Promise<void> {
  const manifest = process.argv[2];
  if (!manifest) throw new Error('Manifest path is required');
  const result = await verifySqliteBackup(manifest);
  process.stdout.write(`${JSON.stringify({ valid: true, ...result }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
