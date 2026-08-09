import path from 'node:path';
import { pool, transaction } from './db.js';
import { config } from './config.js';
import { fetchKompegeTask, parseExternalId } from './kompege.js';
import { storeBuffer } from './storage.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function downloadAsset(asset) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Не удалось скачать ${asset.url}: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > config.maxFileBytes) throw new Error(`Файл больше лимита ${config.maxFileBytes} байт`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > config.maxFileBytes) throw new Error(`Файл больше лимита ${config.maxFileBytes} байт`);
  const mediaType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  return { ...asset, ...await storeBuffer(bytes, asset.name), mediaType };
}

async function persistTask(normalized, downloaded, runId) {
  return transaction(async client => {
    const source = await client.query("SELECT id FROM sources WHERE code='kompege'");
    const sourceId = source.rows[0].id;
    const existing = await client.query(
      `SELECT t.id, t.current_version_id, v.content_hash
       FROM source_tasks st JOIN tasks t ON t.id=st.task_id
       LEFT JOIN task_versions v ON v.id=t.current_version_id
       WHERE st.source_id=$1 AND st.external_id=$2 FOR UPDATE`,
      [sourceId, normalized.externalId]
    );
    let taskId;
    let outcome;
    if (!existing.rowCount) {
      const created = await client.query(
        `INSERT INTO tasks(subject_id, exam_number, title, difficulty)
         VALUES('inf',$1,$2,$3) RETURNING id`,
        [normalized.examNumber, normalized.title, normalized.difficulty]
      );
      taskId = created.rows[0].id;
      await client.query(
        `INSERT INTO source_tasks(source_id,external_id,task_id,source_url,remote_updated_at)
         VALUES($1,$2,$3,$4,$5)`,
        [sourceId, normalized.externalId, taskId, `https://kompege.ru/task?id=${normalized.externalId}`, normalized.remoteUpdatedAt]
      );
      outcome = 'created';
    } else {
      taskId = existing.rows[0].id;
      await client.query(
        `UPDATE source_tasks SET last_seen_at=now(),remote_updated_at=$3
         WHERE source_id=$1 AND external_id=$2`,
        [sourceId, normalized.externalId, normalized.remoteUpdatedAt]
      );
      if (existing.rows[0].content_hash === normalized.contentHash) {
        await client.query('UPDATE import_runs SET unchanged_count=unchanged_count+1 WHERE id=$1', [runId]);
        return 'unchanged';
      }
      await client.query(
        `UPDATE tasks SET exam_number=$2,title=$3,difficulty=$4,updated_at=now() WHERE id=$1`,
        [taskId, normalized.examNumber, normalized.title, normalized.difficulty]
      );
      outcome = 'updated';
    }
    const version = await client.query('SELECT COALESCE(MAX(version),0)+1 AS next FROM task_versions WHERE task_id=$1', [taskId]);
    const inserted = await client.query(
      `INSERT INTO task_versions(task_id,version,statement_html,statement_text,answer,answer_type,compare_mode,solution_html,content_hash,source_payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [taskId, version.rows[0].next, normalized.statementHtml, normalized.statementText,
       normalized.answer, normalized.answerType, normalized.compareMode, normalized.solutionHtml,
       normalized.contentHash, normalized.sourcePayload]
    );
    const versionId = inserted.rows[0].id;
    await client.query('UPDATE tasks SET current_version_id=$2 WHERE id=$1', [taskId, versionId]);
    for (const asset of downloaded) {
      const row = await client.query(
        `INSERT INTO assets(sha256,storage_key,original_filename,media_type,size_bytes)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(sha256) DO UPDATE SET original_filename=assets.original_filename
         RETURNING id`,
        [asset.sha256, asset.storageKey, asset.name, asset.mediaType, asset.sizeBytes]
      );
      await client.query(
        `INSERT INTO task_version_assets(task_version_id,asset_id,kind,original_url,sort_order)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [versionId, row.rows[0].id, asset.kind, asset.url, asset.sortOrder]
      );
    }
    await client.query(`UPDATE import_runs SET ${outcome}_count=${outcome}_count+1 WHERE id=$1`, [runId]);
    return outcome;
  });
}

export async function runKompegeImport(values) {
  const ids = [...new Set(values.map(parseExternalId))];
  if (!ids.length || ids.length > 100) throw new Error('Укажите от 1 до 100 ID заданий');
  const source = await pool.query("SELECT id FROM sources WHERE code='kompege'");
  if (!source.rowCount) throw new Error('Сначала выполните миграции базы данных');
  const run = await pool.query(
    `INSERT INTO import_runs(source_id,status,requested_ids) VALUES($1,'running',$2) RETURNING id`,
    [source.rows[0].id, JSON.stringify(ids)]
  );
  const runId = run.rows[0].id;
  for (let index = 0; index < ids.length; index++) {
    const externalId = ids[index];
    try {
      const task = await fetchKompegeTask(externalId);
      const downloaded = [];
      for (const asset of task.assets) downloaded.push(await downloadAsset(asset));
      await persistTask(task, downloaded, runId);
    } catch (error) {
      await pool.query('UPDATE import_runs SET failed_count=failed_count+1 WHERE id=$1', [runId]);
      await pool.query(
        'INSERT INTO import_errors(import_run_id,external_id,message) VALUES($1,$2,$3)',
        [runId, externalId, error.message]
      );
    }
    if (index < ids.length - 1) await delay(config.importDelayMs);
  }
  await pool.query(
    `UPDATE import_runs SET status=CASE WHEN failed_count=0 THEN 'completed' WHEN created_count+updated_count+unchanged_count=0 THEN 'failed' ELSE 'partial' END,
     finished_at=now() WHERE id=$1`, [runId]
  );
  return getImportRun(runId);
}

export async function getImportRun(id) {
  const run = await pool.query('SELECT * FROM import_runs WHERE id=$1', [id]);
  const errors = await pool.query('SELECT external_id,message,created_at FROM import_errors WHERE import_run_id=$1 ORDER BY id', [id]);
  return { ...run.rows[0], errors: errors.rows };
}

export async function listTasks() {
  const result = await pool.query(
    `SELECT t.id,t.exam_number,t.title,t.difficulty,t.status,v.version,v.statement_text,v.answer,
            st.external_id,st.source_url,
            COALESCE(json_agg(json_build_object('name',a.original_filename,'url','/media/'||a.storage_key,'kind',tva.kind))
              FILTER (WHERE a.id IS NOT NULL),'[]') AS assets
     FROM tasks t JOIN task_versions v ON v.id=t.current_version_id
     LEFT JOIN source_tasks st ON st.task_id=t.id
     LEFT JOIN task_version_assets tva ON tva.task_version_id=v.id
     LEFT JOIN assets a ON a.id=tva.asset_id
     GROUP BY t.id,v.id,st.external_id,st.source_url ORDER BY t.exam_number,t.created_at DESC`
  );
  return result.rows;
}
