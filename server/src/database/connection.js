import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaStatements } from './schema.js';

const DEFAULT_DATABASE_PATH = resolve(process.cwd(), 'data', 'jarvis.sqlite');

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
