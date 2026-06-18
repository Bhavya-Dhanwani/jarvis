// Define the app_state key that stores the active chat.
export const ACTIVE_SESSION_KEY = 'active_session';

// Create a session record for the active chat.
export function createSessionRecord({ chatId }) {
  // Return active chat state with an update timestamp.
  return {
    // Store the active chat ID.
    chatId,
    // Store the time this session was updated.
    updatedAt: new Date().toISOString(),
  };
}

// Convert a SQLite app_state row into a session object.
export function mapSessionRow(row) {
  // Return null when no active session exists.
  if (!row) {
    // Signal missing session data to callers.
    return null;
  }

  // Parse the JSON state value.
  const value = JSON.parse(row.value);

  // Return a normalized session object.
  return {
    // Store the active chat ID from JSON.
    chatId: value.chatId,
    // Map updated_at to updatedAt.
    updatedAt: row.updated_at,
  };
}
