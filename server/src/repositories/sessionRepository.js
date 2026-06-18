// Import session constants and mappers.
import {
  // Key used in app_state for active session.
  ACTIVE_SESSION_KEY,
  // Factory for active session records.
  createSessionRecord,
  // Mapper for app_state rows.
  mapSessionRow,
} from '../models/session.js';

// Persist and load active chat session state.
export class SessionRepository {
  // Store the database dependency.
  constructor(database) {
    // Keep the SQLite connection for repository methods.
    this.database = database;
  }

  // Set the active chat ID.
  setActiveChat(chatId) {
    // Build a normalized session record.
    const session = createSessionRecord({ chatId });

    // Upsert the active session into app_state.
    this.database
      // Prepare insert with conflict update.
      .prepare(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      // Bind state key, JSON value, and timestamp.
      .run(
        // Bind the active session key.
        ACTIVE_SESSION_KEY,
        // Store chat ID as JSON state.
        JSON.stringify({ chatId: session.chatId }),
        // Bind update time.
        session.updatedAt,
      );

    // Return the active session object.
    return session;
  }

  // Get the current active session.
  getActiveSession() {
    // Load active session state from SQLite.
    const row = this.database
      // Prepare the state lookup query.
      .prepare('SELECT * FROM app_state WHERE key = ?')
      // Bind the active session key.
      .get(ACTIVE_SESSION_KEY);

    // Convert the row into a session object.
    return mapSessionRow(row);
  }

  // Clear the active session.
  clearActiveSession() {
    // Delete active session state from SQLite.
    this.database
      // Prepare the delete statement.
      .prepare('DELETE FROM app_state WHERE key = ?')
      // Bind the active session key.
      .run(ACTIVE_SESSION_KEY);
  }
}
