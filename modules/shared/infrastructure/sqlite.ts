import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';

const require = createRequire(__filename);
const databaseModule = require('../../../server/db.js') as { readonly db: Database.Database };

export const sqlite = databaseModule.db;
