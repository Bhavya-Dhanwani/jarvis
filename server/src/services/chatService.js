import { NoChatSessionError } from '../core/errors.js';

export class ChatService {
  constructor({ chatRepository, messageRepository, sessionRepository, assistantService = null }) {
    this.chatRepository = chatRepository;
    this.messageRepository = messageRepository;
    this.sessionRepository = sessionRepository;
    this.assistantService = assistantService;
  }

  startNewChat() {
    const chat = this.chatRepository.createChat({
      title: 'Jarvis chat',
      metadata: {
        source: 'cli',
      },
    });

    this.sessionRepository.setActiveChat(chat.id);

    return {
      chat,
      messages: [],
    };
  }

  saveUserMessage(chatId, content) {
    const message = this.messageRepository.createMessage({
      chatId,
      role: 'user',
      content,
      metadata: {
        source: 'cli',
      },
    });

    this.chatRepository.touch(chatId);
    this.sessionRepository.setActiveChat(chatId);

    return message;
  }

  saveAssistantMessage(chatId, content) {
    const message = this.messageRepository.createMessage({
      chatId,
      role: 'assistant',
      content,
      metadata: {
        source: 'ollama',
      },
    });

    this.chatRepository.touch(chatId);
    this.sessionRepository.setActiveChat(chatId);

    return message;
  }

  async respondToUserMessage(chatId, content) {
    const userMessage = this.saveUserMessage(chatId, content);

    if (!this.assistantService) {
      return { userMessage, assistantMessage: null };
    }

    const messages = this.messageRepository.listByChatId(chatId);
    const reply = await this.assistantService.generateReply(messages);
    const assistantMessage = this.saveAssistantMessage(chatId, reply || '(empty response)');

    return { userMessage, assistantMessage };
  }

  resumeLatestChat() {
    const activeSession = this.sessionRepository.getActiveSession();
    const activeChat = activeSession
      ? this.chatRepository.findById(activeSession.chatId)
      : null;
    const chat = activeChat ?? this.chatRepository.findLatest();

    if (!chat) {
      throw new NoChatSessionError();
    }

    this.sessionRepository.setActiveChat(chat.id);

    return {
      chat,
      messages: this.messageRepository.listByChatId(chat.id),
    };
  }
}
