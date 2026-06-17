import { createMessageRecord, mapMessageRow } from '../models/message.js';

export class MessageRepository {
  constructor(database) {
    this.database = database;
  }

  createMessage(input) {
    const message = createMessageRecord(input);

    this.database
      .prepare(
        `INSERT INTO messages (id, chat_id, role, content, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.chatId,
        message.role,
        message.content,
        JSON.stringify(message.metadata),
        message.createdAt,
      );

    return message;
  }

  listByChatId(chatId) {
    const rows = this.database
      .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
      .all(chatId);

    return rows.map(mapMessageRow);
  }
}
