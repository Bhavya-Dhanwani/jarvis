import { randomUUID } from 'node:crypto';

export function createChatRecord({ title = 'New chat', metadata = {} } = {}) {
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    title,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function mapChatRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
