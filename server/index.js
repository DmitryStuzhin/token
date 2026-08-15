const http = require('http');
const path = require('path');

const { createApp } = require('./app.js');
const { loadConfig } = require('./config.js');
const { createLogger } = require('./logger.js');
const live = require('./live.js');

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp({ config, logger });
const server = http.createServer(app);

app.locals.live = live.create(server, {
  auth: app.locals.auth,
  repository: app.locals.repository,
  logger,
});

async function start() {
  if (config.databaseDriver === 'postgres' && config.databaseMigrateOnStart) {
    const { PostgresMigrator } = require('../packages/db/src/migrator.ts');
    const migrator = new PostgresMigrator(
      app.locals.services.pool,
      path.join(__dirname, '..', 'packages', 'db', 'migrations'),
    );
    await migrator.up();
    const { ensureReferenceData } = require('./reference-data.js');
    await ensureReferenceData(app.locals.services.pool);
  }
  server.listen(config.port, () => {
    void Promise.resolve(app.locals.repository.fullState()).then(state => {
      const counts = {
        subjects: state.subjects.length,
        tasks: state.tasks.length,
        users: state.users.length,
        lessons: state.lessons.length,
      };
      logger.info('server_started', {
        port: config.port,
        environment: config.nodeEnv,
        databaseDriver: config.databaseDriver,
        counts,
      });
    }).catch(error => logger.error('server_state_read_failed', { error: error.message }));
  });
}

void start().catch(error => {
  logger.error('server_start_failed', { error: error.message });
  void app.locals.services.close().finally(() => { process.exitCode = 1; });
});

function shutdown(signal) {
  logger.info('server_stopping', { signal });
  server.close(async () => {
    try { await app.locals.services.close(); } catch (error) {
      logger.error('database_close_failed', { error: error.message });
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
