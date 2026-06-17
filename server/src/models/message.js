import { randomUUID } from 'node:crypto';

export function createMessageRecord({ chatId, role, content, metadata = {} }) {
  return {
    id: randomUUID(),
    chatId,
    role,
    content,
    metadata,
    createdAt: new Date().toISOString(),
  };
}

export function mapMessageRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
  };
}
