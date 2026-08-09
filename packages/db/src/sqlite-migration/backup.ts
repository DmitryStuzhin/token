import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface BackupManifest {
  readonly source: string;
  readonly backup: string;
  readonly createdAt: string;
  readonly bytes: number;
  readonly sha256: string;
}

async function checksum(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function createSqliteBackup(
  sourceFile: string,
  directory: string,
): Promise<BackupManifest & { readonly manifest: string }> {
  const source = path.resolve(sourceFile);
  const targetDirectory = path.resolve(directory);
  await fs.mkdir(targetDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(targetDirectory, `token-${stamp}.db`);
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  const manifest: BackupManifest = {
    source,
    backup: destination,
    createdAt: new Date().toISOString(),
    bytes: (await fs.stat(destination)).size,
    sha256: await checksum(destination),
  };
  const manifestFile = `${destination}.json`;
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { ...manifest, manifest: manifestFile };
}

export async function verifySqliteBackup(manifestFile: string): Promise<BackupManifest> {
  const manifest = JSON.parse(
    await fs.readFile(path.resolve(manifestFile), 'utf8'),
  ) as BackupManifest;
  if ((await fs.stat(manifest.backup)).size !== manifest.bytes) {
    throw new Error('SQLite backup size does not match manifest');
  }
  if ((await checksum(manifest.backup)) !== manifest.sha256) {
    throw new Error('SQLite backup checksum does not match manifest');
  }
  const database = new Database(manifest.backup, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`SQLite integrity_check failed: ${String(result)}`);
  } finally {
    database.close();
  }
  return manifest;
}
