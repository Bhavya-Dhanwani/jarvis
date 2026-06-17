import {
  ACTIVE_SESSION_KEY,
  createSessionRecord,
  mapSessionRow,
} from '../models/session.js';

export class SessionRepository {
  constructor(database) {
    this.database = database;
  }

  setActiveChat(chatId) {
    const session = createSessionRecord({ chatId });

    this.database
      .prepare(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(
        ACTIVE_SESSION_KEY,
        JSON.stringify({ chatId: session.chatId }),
        session.updatedAt,
      );

    return session;
  }

  getActiveSession() {
    const row = this.database
      .prepare('SELECT * FROM app_state WHERE key = ?')
      .get(ACTIVE_SESSION_KEY);

    return mapSessionRow(row);
  }

  clearActiveSession() {
    this.database
      .prepare('DELETE FROM app_state WHERE key = ?')
      .run(ACTIVE_SESSION_KEY);
  }
}
