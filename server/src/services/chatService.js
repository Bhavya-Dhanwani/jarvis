import { NoChatSessionError } from '../core/errors.js';

export class ChatService {
  constructor({ chatRepository, messageRepository, sessionRepository }) {
    this.chatRepository = chatRepository;
    this.messageRepository = messageRepository;
    this.sessionRepository = sessionRepository;
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
