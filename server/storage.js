import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';

const safeName = name => String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120);

export async function storeBuffer(bytes, filename) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = `${sha256.slice(0, 2)}/${sha256}-${safeName(filename)}`;
  const target = path.join(config.storageDir, storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  try { await stat(target); } catch { await writeFile(target, bytes, { flag: 'wx' }); }
  return { sha256, storageKey, sizeBytes: bytes.length };
}
