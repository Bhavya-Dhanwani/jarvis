// Import message factory and row mapper.
import { createMessageRecord, mapMessageRow } from '../models/message.js';

// Persist and load message records.
export class MessageRepository {
  // Store the database dependency.
  constructor(database) {
    // Keep the SQLite connection for repository methods.
    this.database = database;
  }

  // Create a message row.
  createMessage(input) {
    // Build a normalized message record.
    const message = createMessageRecord(input);

    // Insert the message into SQLite.
    this.database
      // Prepare the insert statement.
      .prepare(
        `INSERT INTO messages (id, chat_id, role, content, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      // Bind message values into the statement.
      .run(
        // Bind message ID.
        message.id,
        // Bind owning chat ID.
        message.chatId,
        // Bind role.
        message.role,
        // Bind content.
        message.content,
        // Store metadata as JSON.
        JSON.stringify(message.metadata),
        // Bind creation time.
        message.createdAt,
      );

    // Return the created message object.
    return message;
  }

  // List messages for a chat in chronological order.
  listByChatId(chatId) {
    // Load all rows for the chat.
    const rows = this.database
      // Prepare the ordered history query.
      .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
      // Bind the chat ID.
      .all(chatId);

    // Convert rows into app objects.
    return rows.map(mapMessageRow);
  }
}
