import { createChatRecord, mapChatRow } from '../models/chat.js';

export class ChatRepository {
  constructor(database) {
    this.database = database;
  }

  createChat(input = {}) {
    const chat = createChatRecord(input);

    this.database
      .prepare(
        `INSERT INTO chats (id, title, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        chat.id,
        chat.title,
        JSON.stringify(chat.metadata),
        chat.createdAt,
        chat.updatedAt,
      );

    return chat;
  }

  findById(chatId) {
    const row = this.database
      .prepare('SELECT * FROM chats WHERE id = ?')
      .get(chatId);

    return mapChatRow(row);
  }

  findLatest() {
    const row = this.database
      .prepare('SELECT * FROM chats ORDER BY updated_at DESC, created_at DESC LIMIT 1')
      .get();

    return mapChatRow(row);
  }

  touch(chatId) {
    const updatedAt = new Date().toISOString();

    this.database
      .prepare('UPDATE chats SET updated_at = ? WHERE id = ?')
      .run(updatedAt, chatId);

    return this.findById(chatId);
  }
}
