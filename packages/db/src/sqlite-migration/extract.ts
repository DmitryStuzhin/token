import path from 'node:path';
import Database from 'better-sqlite3';
import type { ExtractedDataset, LegacyRow } from './types.js';

export const LEGACY_TABLES = [
  'subjects',
  'topics',
  'tasks',
  'users',
  'sessions',
  'student_profiles',
  'tutor_profiles',
  'invites',
  'enrollments',
  'groups',
  'group_members',
  'lessons',
  'lesson_attendance',
  'assignments',
  'attempts',
  'goals',
  'subscriptions',
  'notification_prefs',
  'mock_exams',
] as const;

export function extractSqlite(sourceFile: string): ExtractedDataset {
  const resolved = path.resolve(sourceFile);
  const database = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    database.pragma('foreign_keys = ON');
    const tables: Record<string, readonly LegacyRow[]> = {};
    const existing = new Set(
      (
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    for (const table of LEGACY_TABLES) {
      tables[table] = existing.has(table)
        ? (database.prepare(`SELECT * FROM ${table}`).all() as LegacyRow[])
        : [];
    }
    return {
      sourceFile: resolved,
      extractedAt: new Date().toISOString(),
      tables,
    };
  } finally {
    database.close();
  }
}
