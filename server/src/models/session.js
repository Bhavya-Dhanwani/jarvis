export const ACTIVE_SESSION_KEY = 'active_session';

export function createSessionRecord({ chatId }) {
  return {
    chatId,
    updatedAt: new Date().toISOString(),
  };
}

export function mapSessionRow(row) {
  if (!row) {
    return null;
  }

  const value = JSON.parse(row.value);

  return {
    chatId: value.chatId,
    updatedAt: row.updated_at,
  };
}
