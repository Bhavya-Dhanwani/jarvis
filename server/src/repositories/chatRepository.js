// Import chat factory and row mapper.
import { createChatRecord, mapChatRow } from '../models/chat.js';

// Persist and load chat records.
export class ChatRepository {
  // Store the database dependency.
  constructor(database) {
    // Keep the SQLite connection for repository methods.
    this.database = database;
  }

  // Create a chat row.
  createChat(input = {}) {
    // Build a normalized chat record.
    const chat = createChatRecord(input);

    // Insert the chat into SQLite.
    this.database
      // Prepare the insert statement.
      .prepare(
        `INSERT INTO chats (id, title, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      // Bind chat values into the statement.
      .run(
        // Bind chat ID.
        chat.id,
        // Bind chat title.
        chat.title,
        // Store metadata as JSON.
        JSON.stringify(chat.metadata),
        // Bind creation time.
        chat.createdAt,
        // Bind update time.
        chat.updatedAt,
      );

    // Return the created chat object.
    return chat;
  }

  // Find a chat by ID.
  findById(chatId) {
    // Load the matching row from SQLite.
    const row = this.database
      // Prepare the lookup query.
      .prepare('SELECT * FROM chats WHERE id = ?')
      // Bind the requested chat ID.
      .get(chatId);

    // Convert the row into an app object.
    return mapChatRow(row);
  }

  // Find the most recently updated chat.
  findLatest() {
    // Load the latest chat row.
    const row = this.database
      // Order by update time and creation time.
      .prepare('SELECT * FROM chats ORDER BY updated_at DESC, created_at DESC LIMIT 1')
      // Execute the query.
      .get();

    // Convert the row into an app object.
    return mapChatRow(row);
  }

  // Update a chat's updated_at timestamp.
  touch(chatId) {
    // Create the current timestamp.
    const updatedAt = new Date().toISOString();

    // Update the chat row.
    this.database
      // Prepare the update statement.
      .prepare('UPDATE chats SET updated_at = ? WHERE id = ?')
      // Bind timestamp and chat ID.
      .run(updatedAt, chatId);

    // Return the refreshed chat.
    return this.findById(chatId);
  }
}
