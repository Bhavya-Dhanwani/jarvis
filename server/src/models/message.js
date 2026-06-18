// Import randomUUID to create unique message IDs.
import { randomUUID } from 'node:crypto';

// Create a new message domain record.
export function createMessageRecord({ chatId, role, content, metadata = {} }) {
  // Return the normalized message object.
  return {
    // Generate a unique message ID.
    id: randomUUID(),
    // Store the owning chat ID.
    chatId,
    // Store the message role.
    role,
    // Store the message text.
    content,
    // Store caller-provided metadata.
    metadata,
    // Store creation time.
    createdAt: new Date().toISOString(),
  };
}

// Convert a SQLite message row into an app message object.
export function mapMessageRow(row) {
  // Return null when no row was found.
  if (!row) {
    // Signal missing data to callers.
    return null;
  }

  // Return a camelCase message object.
  return {
    // Copy the message ID.
    id: row.id,
    // Map chat_id to chatId.
    chatId: row.chat_id,
    // Copy the message role.
    role: row.role,
    // Copy the message content.
    content: row.content,
    // Parse JSON metadata from storage.
    metadata: JSON.parse(row.metadata),
    // Map created_at to createdAt.
    createdAt: row.created_at,
  };
}
