import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { runCli } from '../src/cli/index.js';
import { createInitializedDatabase } from '../src/database/connection.js';
import { ChatRepository } from '../src/repositories/chatRepository.js';
import { MessageRepository } from '../src/repositories/messageRepository.js';
import { SessionRepository } from '../src/repositories/sessionRepository.js';

test('CLI creates a chat, persists messages, and resumes the active chat', async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'jarvis-cli-')), 'jarvis.sqlite');
  const database = createInitializedDatabase(databasePath);
  const chatRepository = new ChatRepository(database);
  const messageRepository = new MessageRepository(database);
  const sessionRepository = new SessionRepository(database);

  try {
    const firstOutput = createOutputCapture();

    await runCli([], {
      database,
      input: Readable.from(['hello jarvis\n', '/exit\n']),
      outputStream: firstOutput.stream,
      output: firstOutput.writeLine,
    });

    const chat = chatRepository.findLatest();
    assert.ok(chat);
    assert.equal(chat.title, 'Jarvis chat');
    assert.deepEqual(chat.metadata, { source: 'cli' });

    const firstMessages = messageRepository.listByChatId(chat.id);
    assert.equal(firstMessages.length, 1);
    assert.equal(firstMessages[0].role, 'user');
    assert.equal(firstMessages[0].content, 'hello jarvis');
    assert.deepEqual(firstMessages[0].metadata, { source: 'cli' });

    const activeSession = sessionRepository.getActiveSession();
    assert.equal(activeSession.chatId, chat.id);

    const secondOutput = createOutputCapture();

    await runCli(['resume'], {
      database,
      input: Readable.from(['continue\n', '/exit\n']),
      outputStream: secondOutput.stream,
      output: secondOutput.writeLine,
    });

    const resumedMessages = messageRepository.listByChatId(chat.id);
    assert.equal(resumedMessages.length, 2);
    assert.equal(resumedMessages[1].content, 'continue');
    assert.equal(sessionRepository.getActiveSession().chatId, chat.id);
    assert.match(secondOutput.text(), /Loaded 1 messages\./);
  } finally {
    database.close();
  }
});

function createOutputCapture() {
  const chunks = [];

  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk).toString('utf8'));
      callback();
    },
  });

  return {
    stream,
    writeLine(value) {
      chunks.push(`${value}\n`);
    },
    text() {
      return chunks.join('');
    },
  };
}
