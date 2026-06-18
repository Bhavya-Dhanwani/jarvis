// Import the friendly no-session error.
import { NoChatSessionError } from '../core/errors.js';

// Coordinate chat persistence and assistant responses.
export class ChatService {
  // Store repository and assistant dependencies.
  constructor({ chatRepository, messageRepository, sessionRepository, assistantService = null }) {
    // Store chat persistence dependency.
    this.chatRepository = chatRepository;
    // Store message persistence dependency.
    this.messageRepository = messageRepository;
    // Store active session persistence dependency.
    this.sessionRepository = sessionRepository;
    // Store optional assistant dependency.
    this.assistantService = assistantService;
  }

  // Start a new chat session.
  startNewChat() {
    // Create a new chat record.
    const chat = this.chatRepository.createChat({
      // Use a default JARVIS chat title.
      title: 'Jarvis chat',
      // Store CLI source metadata.
      metadata: {
        // Mark this chat as created by the CLI.
        source: 'cli',
      },
    });

    // Mark the new chat as active.
    this.sessionRepository.setActiveChat(chat.id);

    // Return the new chat with empty history.
    return {
      // Include the created chat.
      chat,
      // New chats start with no messages.
      messages: [],
    };
  }

  // Save a user message to a chat.
  saveUserMessage(chatId, content) {
    // Create the user message record.
    const message = this.messageRepository.createMessage({
      // Store the owning chat ID.
      chatId,
      // Mark message as user role.
      role: 'user',
      // Store the user's text.
      content,
      // Store CLI metadata.
      metadata: {
        // Mark this message as coming from the CLI.
        source: 'cli',
      },
    });

    // Update the chat timestamp.
    this.chatRepository.touch(chatId);
    // Keep this chat active.
    this.sessionRepository.setActiveChat(chatId);

    // Return the saved user message.
    return message;
  }

  // Save an assistant message to a chat.
  saveAssistantMessage(chatId, content) {
    // Create the assistant message record.
    const message = this.messageRepository.createMessage({
      // Store the owning chat ID.
      chatId,
      // Mark message as assistant role.
      role: 'assistant',
      // Store the assistant text.
      content,
      // Store Ollama metadata.
      metadata: {
        // Mark this message as coming from Ollama.
        source: 'ollama',
      },
    });

    // Update the chat timestamp.
    this.chatRepository.touch(chatId);
    // Keep this chat active.
    this.sessionRepository.setActiveChat(chatId);

    // Return the saved assistant message.
    return message;
  }

  // Save a user message and optionally generate an assistant reply.
  async respondToUserMessage(chatId, content) {
    // Persist the user's message first.
    const userMessage = this.saveUserMessage(chatId, content);

    // Stop after saving when no assistant service is configured.
    if (!this.assistantService) {
      // Return only the user message.
      return { userMessage, assistantMessage: null };
    }

    // Load full chat history for the assistant.
    const messages = this.messageRepository.listByChatId(chatId);
    // Generate a reply from the assistant service.
    const reply = await this.assistantService.generateReply(messages);
    // Save the assistant reply, preserving empty responses visibly.
    const assistantMessage = this.saveAssistantMessage(chatId, reply || '(empty response)');

    // Return both saved messages.
    return { userMessage, assistantMessage };
  }

  // Resume the latest active or recent chat.
  resumeLatestChat() {
    // Load active session state.
    const activeSession = this.sessionRepository.getActiveSession();
    // Try to load the active chat first.
    const activeChat = activeSession
      // Load chat by active session ID.
      ? this.chatRepository.findById(activeSession.chatId)
      // Use null when no active session exists.
      : null;
    // Fall back to the most recently updated chat.
    const chat = activeChat ?? this.chatRepository.findLatest();

    // Fail if no chat exists to resume.
    if (!chat) {
      // Throw the friendly no-session error.
      throw new NoChatSessionError();
    }

    // Mark the resumed chat as active.
    this.sessionRepository.setActiveChat(chat.id);

    // Return the chat and its message history.
    return {
      // Include the resumed chat.
      chat,
      // Include persisted messages for the chat.
      messages: this.messageRepository.listByChatId(chat.id),
    };
  }
}
