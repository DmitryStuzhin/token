import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import request from 'supertest';
import { InProcessEventDispatcher } from '../../modules/shared/infrastructure/in-process-dispatcher.js';
import { ChangeLessonStatus } from '../../modules/scheduling/application/change-lesson-status.js';
import { PostgresSchedulingRepository } from '../../modules/scheduling/infrastructure/postgres-scheduling-repository.js';
import { extractSqlite } from '../../packages/db/src/sqlite-migration/extract.js';
import { loadPostgres } from '../../packages/db/src/sqlite-migration/load.js';
import { transformDataset } from '../../packages/db/src/sqlite-migration/transform.js';
import { loadMigrations } from '../../packages/db/src/migrator.js';

void test('public HTTP learning flow runs on the PostgreSQL adapter', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'token-pg-http-'));
  const source = path.join(directory, 'seed.db');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_DRIVER = 'sqlite';
  process.env.TOKEN_DB = source;
  process.env.LOG_LEVEL = 'silent';
  const require = createRequire(__filename);
  const sqlite = require('../../server/db.js') as { readonly db: { close(): void } };
  sqlite.db.close();

  const database = new PGlite();
  const migrations = await loadMigrations(path.join(process.cwd(), 'packages', 'db', 'migrations'));
  for (const migration of migrations) await database.exec(migration.up);
  const query = async (sql: string, parameters?: readonly unknown[]) => {
    const result = await database.query(sql, parameters ? [...parameters] : []);
    return {
      ...result,
      rowCount:
        result.affectedRows ??
        (sql.trimStart().toUpperCase().startsWith('SELECT') ? result.rows.length : 0),
    };
  };
  const client = { query, release: () => undefined };
  const pool = {
    query,
    connect: async () => client,
    end: async () => undefined,
  } as unknown as pg.Pool;
  await loadPostgres(pool, transformDataset(extractSqlite(source)));

  const { loadConfig } =
    require('../../server/config.js') as typeof import('../../server/config.js');
  const { createApp } = require('../../server/app.js') as {
    createApp(options: Readonly<Record<string, unknown>>): ReturnType<typeof import('express')>;
  };
  const { AuthService } = require('../../modules/identity/application/auth-service.js') as {
    AuthService: new (store: unknown, roles: unknown, options?: Record<string, unknown>) => unknown;
  };
  const { PostgresIdentityStore } =
    require('../../modules/identity/infrastructure/postgres-identity-store.js') as {
      PostgresIdentityStore: new (databasePool: pg.Pool) => unknown;
    };
  const { PostgresPlatformRepository } =
    require('../../modules/platform/infrastructure/postgres-platform-repository.js') as {
      PostgresPlatformRepository: new (databasePool: pg.Pool) => unknown;
    };
  const Auth = require('../../server/auth.js') as { readonly ROLES: unknown };
  const events = new InProcessEventDispatcher();
  const schedulingRepository = new PostgresSchedulingRepository(pool);
  const services = {
    pool,
    events,
    scheduling: { changeLessonStatus: new ChangeLessonStatus(schedulingRepository, events) },
    close: async () => undefined,
  };
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_DRIVER: 'postgres',
    DATABASE_URL: 'postgresql://embedded/token',
    LOG_LEVEL: 'silent',
  });
  const app = createApp({
    config,
    services,
    auth: new AuthService(new PostgresIdentityStore(pool), Auth.ROLES, {
      exposeTokens: true,
      publicOrigin: 'http://localhost:3000',
    }),
    repository: new PostgresPlatformRepository(pool),
  });

  try {
    const tutor = request.agent(app);
    const student = request.agent(app);
    const register = async (
      agent: ReturnType<typeof request.agent>,
      data: Record<string, unknown>,
    ) => {
      const registration = await agent.post('/api/auth/register').send(data);
      assert.equal(registration.status, 201, registration.text);
      const verification = new URL(String(registration.body.verificationUrl));
      assert.equal((await agent.get(verification.pathname + verification.search)).status, 302);
      const login = await agent.post('/api/auth/login').send({
        email: data.email,
        password: data.password,
      });
      assert.equal(login.status, 200, login.text);
    };
    await register(tutor, {
      name: 'Postgres Tutor',
      email: 'pg-tutor@example.test',
      password: 'test-password',
      role: 'tutor',
      subjects: ['inf'],
    });
    await register(student, {
      name: 'Postgres Student',
      email: 'pg-student@example.test',
      password: 'test-password',
      role: 'student',
      grade: 11,
    });
    const invite = await tutor.post('/api/invites').send({
      kind: 'enrollment',
      subjectId: 'inf',
      maxUses: 1,
    });
    assert.equal(invite.status, 200, invite.text);
    const accepted = await student
      .post('/api/invites/accept')
      .send({ code: invite.body.invite.code });
    assert.equal(accepted.status, 200, accepted.text);
    const state = await tutor.get('/api/state');
    assert.equal(state.status, 200, state.text);
    assert.equal(state.body.enrollments.length, 1);
    assert.equal(
      state.body.tasks.some((task: Record<string, unknown>) => 'answer' in task),
      false,
    );
  } finally {
    await database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
