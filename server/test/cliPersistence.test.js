// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import mkdtempSync to create isolated test folders.
import { mkdtempSync } from 'node:fs';
// Import tmpdir to place test databases in the OS temp folder.
import { tmpdir } from 'node:os';
// Import join for building test paths.
import { join } from 'node:path';
// Import streams to simulate CLI input and output.
import { Readable, Writable } from 'node:stream';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the CLI runner under test.
import { runCli } from '../src/cli/index.js';
// Import database initializer for isolated test databases.
import { createInitializedDatabase } from '../src/database/connection.js';
// Import chat repository for test assertions.
import { ChatRepository } from '../src/repositories/chatRepository.js';
// Import message repository for test assertions.
import { MessageRepository } from '../src/repositories/messageRepository.js';
// Import session repository for test assertions.
import { SessionRepository } from '../src/repositories/sessionRepository.js';

// Verify that CLI chats persist and resume correctly.
test('CLI creates a chat, persists messages, and resumes the active chat', async () => {
  // Create a unique temporary database path.
  const databasePath = join(mkdtempSync(join(tmpdir(), 'jarvis-cli-')), 'jarvis.sqlite');
  // Create an initialized SQLite database.
  const database = createInitializedDatabase(databasePath);
  // Create repository for chat assertions.
  const chatRepository = new ChatRepository(database);
  // Create repository for message assertions.
  const messageRepository = new MessageRepository(database);
  // Create repository for session assertions.
  const sessionRepository = new SessionRepository(database);

  // Ensure the database closes after the test.
  try {
    // Create output capture for the first CLI run.
    const firstOutput = createOutputCapture();

    // Run a new chat with scripted input.
    await runCli([], {
      // Reuse the isolated test database.
      database,
      // Send one message and then exit.
      input: Readable.from(['hello jarvis\n', '/exit\n']),
      // Capture stream output.
      outputStream: firstOutput.stream,
      // Capture line output.
      output: firstOutput.writeLine,
      // Use a fake assistant to avoid network calls.
      assistantService: createFakeAssistant('hello human'),
    });

    // Load the latest chat from the database.
    const chat = chatRepository.findLatest();
    // Assert that the chat exists.
    assert.ok(chat);
    // Assert the chat title.
    assert.equal(chat.title, 'Jarvis chat');
    // Assert chat metadata.
    assert.deepEqual(chat.metadata, { source: 'cli' });

    // Load persisted messages for the chat.
    const firstMessages = messageRepository.listByChatId(chat.id);
    // Assert user and assistant messages were saved.
    assert.equal(firstMessages.length, 2);
    // Assert first message role.
    assert.equal(firstMessages[0].role, 'user');
    // Assert first message content.
    assert.equal(firstMessages[0].content, 'hello jarvis');
    // Assert first message metadata.
    assert.deepEqual(firstMessages[0].metadata, { source: 'cli' });
    // Assert second message role.
    assert.equal(firstMessages[1].role, 'assistant');
    // Assert second message content.
    assert.equal(firstMessages[1].content, 'hello human');
    // Assert second message metadata.
    assert.deepEqual(firstMessages[1].metadata, { source: 'ollama' });

    // Load active session state.
    const activeSession = sessionRepository.getActiveSession();
    // Assert the active session points to the chat.
    assert.equal(activeSession.chatId, chat.id);

    // Create output capture for the resume run.
    const secondOutput = createOutputCapture();

    // Resume the chat with another scripted message.
    await runCli(['resume'], {
      // Reuse the same isolated database.
      database,
      // Send one more message and then exit.
      input: Readable.from(['continue\n', '/exit\n']),
      // Capture stream output.
      outputStream: secondOutput.stream,
      // Capture line output.
      output: secondOutput.writeLine,
      // Use a second fake assistant reply.
      assistantService: createFakeAssistant('still here'),
    });

    // Load messages after resume.
    const resumedMessages = messageRepository.listByChatId(chat.id);
    // Assert both runs persisted four messages total.
    assert.equal(resumedMessages.length, 4);
    // Assert resumed user message content.
    assert.equal(resumedMessages[2].content, 'continue');
    // Assert resumed assistant reply content.
    assert.equal(resumedMessages[3].content, 'still here');
    // Assert active session still points to the same chat.
    assert.equal(sessionRepository.getActiveSession().chatId, chat.id);
    // Assert resume header reported prior messages.
    assert.match(secondOutput.text(), /Messages loaded: 2/);
  // Always close the database.
  } finally {
    // Close the SQLite connection.
    database.close();
  }
});

// Create a writable stream that records all output.
function createOutputCapture() {
  // Store output chunks in memory.
  const chunks = [];

  // Create a writable stream for CLI output.
  const stream = new Writable({
    // Capture each written chunk.
    write(chunk, encoding, callback) {
      // Store the chunk as UTF-8 text.
      chunks.push(Buffer.from(chunk).toString('utf8'));
      // Signal that writing completed.
      callback();
    },
  });

  // Return capture helpers.
  return {
    // Expose the writable stream.
    stream,
    // Capture line-based output.
    writeLine(value) {
      // Append a newline like console.log would.
      chunks.push(`${value}\n`);
    },
    // Return all captured text.
    text() {
      // Join all output chunks together.
      return chunks.join('');
    },
  };
}

// Create a fake assistant service for tests.
function createFakeAssistant(reply) {
  // Return an object matching the assistant service shape.
  return {
    // Return the configured reply for any prompt.
    async generateReply() {
      // Resolve with the fake reply.
      return reply;
    },
  };
}
