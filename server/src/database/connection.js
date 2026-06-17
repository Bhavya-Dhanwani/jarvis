import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { schemaStatements } from './schema.js';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DATABASE_PATH = resolve(SERVER_ROOT, 'data', 'jarvis.sqlite');

export function getDatabasePath() {
  return resolve(process.env.JARVIS_DB_PATH ?? DEFAULT_DATABASE_PATH);
}

export function createDatabase(databasePath = getDatabasePath()) {
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

export function initializeDatabase(database) {
  for (const statement of schemaStatements) {
    database.exec(statement);
  }

  return database;
}

export function createInitializedDatabase(databasePath = getDatabasePath()) {
  return initializeDatabase(createDatabase(databasePath));
}
