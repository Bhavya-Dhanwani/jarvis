// Import randomUUID to create unique chat IDs.
import { randomUUID } from 'node:crypto';

// Create a new chat domain record.
export function createChatRecord({ title = 'New chat', metadata = {} } = {}) {
  // Use one timestamp for both created and updated fields.
  const timestamp = new Date().toISOString();

  // Return the normalized chat object.
  return {
    // Generate a unique chat ID.
    id: randomUUID(),
    // Store the chat title.
    title,
    // Store caller-provided metadata.
    metadata,
    // Store creation time.
    createdAt: timestamp,
    // Store last update time.
    updatedAt: timestamp,
  };
}

// Convert a SQLite chat row into an app chat object.
export function mapChatRow(row) {
  // Return null when no row was found.
  if (!row) {
    // Signal missing data to callers.
    return null;
  }

  // Return a camelCase chat object.
  return {
    // Copy the chat ID.
    id: row.id,
    // Copy the title.
    title: row.title,
    // Parse JSON metadata from storage.
    metadata: JSON.parse(row.metadata),
    // Map created_at to createdAt.
    createdAt: row.created_at,
    // Map updated_at to updatedAt.
    updatedAt: row.updated_at,
  };
}
