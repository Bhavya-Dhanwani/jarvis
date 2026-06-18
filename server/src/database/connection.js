// Import mkdirSync to ensure the database folder exists.
import { mkdirSync } from 'node:fs';
// Import path helpers for safe absolute paths.
import { dirname, resolve } from 'node:path';
// Import Node's built-in synchronous SQLite driver.
import { DatabaseSync } from 'node:sqlite';
// Import fileURLToPath to convert module URLs into paths.
import { fileURLToPath } from 'node:url';
// Import SQL schema statements.
import { schemaStatements } from './schema.js';

// Resolve the server package root folder.
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Define the default SQLite database path.
const DEFAULT_DATABASE_PATH = resolve(SERVER_ROOT, 'data', 'jarvis.sqlite');

// Resolve the active database path.
export function getDatabasePath() {
  // Prefer env override, otherwise use the default database.
  return resolve(process.env.JARVIS_DB_PATH ?? DEFAULT_DATABASE_PATH);
}

// Create a SQLite database connection.
export function createDatabase(databasePath = getDatabasePath()) {
  // Ensure the parent folder exists before opening SQLite.
  mkdirSync(dirname(databasePath), { recursive: true });

  // Open the SQLite database.
  const database = new DatabaseSync(databasePath);
  // Enable foreign key constraints.
  database.exec('PRAGMA foreign_keys = ON');
  // Return the database connection.
  return database;
}

// Apply database schema migrations.
export function initializeDatabase(database) {
  // Execute every schema statement.
  for (const statement of schemaStatements) {
    // Run the current schema statement.
    database.exec(statement);
  }

  // Return the initialized database for chaining.
  return database;
}

// Create and initialize a database connection.
export function createInitializedDatabase(databasePath = getDatabasePath()) {
  // Create the database and apply schema.
  return initializeDatabase(createDatabase(databasePath));
}
