import { createRequire } from 'node:module';
import type pg from 'pg';
import type { AppConfig } from '../server/config.js';
import { createPostgresPool } from '../packages/db/src/postgres.js';
import { RevokeInvite } from './relationships/application/revoke-invite.js';
import type { RelationshipRepository } from './relationships/application/ports.js';
import { PostgresRelationshipRepository } from './relationships/infrastructure/postgres-relationship-repository.js';
import { ChangeLessonStatus } from './scheduling/application/change-lesson-status.js';
import type { SchedulingRepository } from './scheduling/application/ports.js';
import { PostgresSchedulingRepository } from './scheduling/infrastructure/postgres-scheduling-repository.js';
import type { LearningRepository } from './learning/application/ports.js';
import { PostgresLearningRepository } from './learning/infrastructure/postgres-learning-repository.js';
import { InProcessEventDispatcher } from './shared/infrastructure/in-process-dispatcher.js';

const require = createRequire(__filename);

export interface ApplicationContainer {
  readonly events: InProcessEventDispatcher;
  readonly pool: pg.Pool | null;
  readonly relationships: {
    readonly revokeInvite: RevokeInvite;
  };
  readonly scheduling: {
    readonly changeLessonStatus: ChangeLessonStatus;
  };
  readonly repositories: {
    readonly relationships: RelationshipRepository;
    readonly scheduling: SchedulingRepository;
    readonly learning: LearningRepository;
  };
  close(): Promise<void>;
}

export function createContainer(config: AppConfig): ApplicationContainer {
  const events = new InProcessEventDispatcher();
  let pool: pg.Pool | null = null;
  let relationships: RelationshipRepository;
  let scheduling: SchedulingRepository;
  let learning: LearningRepository;
  if (config.databaseDriver === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
    pool = createPostgresPool({
      connectionString: config.databaseUrl,
      maxConnections: config.databasePoolMax,
      statementTimeoutMs: config.databaseStatementTimeoutMs,
    });
    relationships = new PostgresRelationshipRepository(pool);
    scheduling = new PostgresSchedulingRepository(pool);
    learning = new PostgresLearningRepository(pool);
  } else {
    const { SqliteRelationshipRepository } =
      require('./relationships/infrastructure/sqlite-relationship-repository.ts') as {
        SqliteRelationshipRepository: new () => RelationshipRepository;
      };
    const { SqliteSchedulingRepository } =
      require('./scheduling/infrastructure/sqlite-scheduling-repository.ts') as {
        SqliteSchedulingRepository: new () => SchedulingRepository;
      };
    const { SqliteLearningRepository } =
      require('./learning/infrastructure/sqlite-learning-repository.ts') as {
        SqliteLearningRepository: new () => LearningRepository;
      };
    relationships = new SqliteRelationshipRepository();
    scheduling = new SqliteSchedulingRepository();
    learning = new SqliteLearningRepository();
  }
  return {
    events,
    pool,
    relationships: {
      revokeInvite: new RevokeInvite(relationships),
    },
    scheduling: {
      changeLessonStatus: new ChangeLessonStatus(scheduling, events),
    },
    repositories: { relationships, scheduling, learning },
    async close(): Promise<void> {
      if (pool) await pool.end();
    },
  };
}
