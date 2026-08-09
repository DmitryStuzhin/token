import { createHash } from 'node:crypto';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { config } from './config.js';

const ALLOWED_PROTOCOLS = ['http', 'https'];

export function parseExternalId(value) {
  const raw = String(value || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  let url;
  try { url = new URL(raw); } catch { throw new Error(`Некорректный ID или URL: ${raw}`); }
  if (!['kompege.ru', 'www.kompege.ru'].includes(url.hostname)) throw new Error('Разрешены только URL сайта kompege.ru');
  const id = url.searchParams.get('id') || url.pathname.match(/\/task\/(\d+)/)?.[1];
  if (!id || !/^\d+$/.test(id)) throw new Error(`В URL не найден числовой id: ${raw}`);
  return id;
}

export function normalizeTask(payload) {
  if (!payload || !Number.isInteger(payload.taskId) || !Number.isInteger(payload.number)) {
    throw new Error('Источник вернул задание неизвестного формата');
  }
  const clean = sanitizeHtml(String(payload.text || ''), {
    allowedTags: ['p','br','b','strong','i','em','u','s','sub','sup','ul','ol','li','table','thead','tbody','tr','th','td','blockquote','code','pre','img','a'],
    allowedAttributes: { a: ['href'], img: ['src','alt','title'], td: ['colspan','rowspan'], th: ['colspan','rowspan'] },
    allowedSchemes: ALLOWED_PROTOCOLS,
  });
  const $ = cheerio.load(clean);
  const inlineImages = [];
  $('img').each((index, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const url = new URL(src, config.kompegeSiteBase).toString();
    inlineImages.push({ url, name: path.basename(new URL(url).pathname) || `image-${index + 1}`, kind: 'image', sortOrder: index });
    $(el).attr('src', url);
  });
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (href) $(el).attr('href', new URL(href, config.kompegeSiteBase).toString());
  });
  const statementHtml = $('body').html()?.trim() || clean;
  const statementText = $('body').text().replace(/\s+/g, ' ').trim();
  const attachments = (payload.files || []).map((file, index) => ({
    url: new URL(file.url, config.kompegeSiteBase).toString(),
    name: file.name || path.basename(file.url), kind: 'attachment', sortOrder: inlineImages.length + index,
  }));
  const answer = payload.hide ? null : String(payload.key ?? '').trim() || null;
  const compareMode = answer?.split(/\s+/).length > 1 ? 'set' : 'exact';
  const title = payload.comment?.trim() || `Задание №${payload.taskId}`;
  const normalized = {
    externalId: String(payload.taskId), examNumber: payload.number, title,
    difficulty: payload.difficulty || null, statementHtml, statementText,
    answer, answerType: compareMode === 'set' ? 'set' : 'string', compareMode,
    solutionHtml: sanitizeHtml(String(payload.solve_text || '')) || null,
    remoteUpdatedAt: payload.updatedAt || null, sourcePayload: payload,
    assets: [...inlineImages, ...attachments],
  };
  normalized.contentHash = createHash('sha256').update(JSON.stringify({
    statementHtml, answer, solutionHtml: normalized.solutionHtml,
    assets: normalized.assets.map(x => [x.url, x.name, x.kind]),
  })).digest('hex');
  return normalized;
}

export async function fetchKompegeTask(externalId, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.kompegeApiBase}/task/${externalId}`, {
    headers: { accept: 'application/json', 'user-agent': 'arcs.studio importer/0.1 (educational project)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`КомпЕГЭ вернул HTTP ${response.status}`);
  return normalizeTask(await response.json());
}
