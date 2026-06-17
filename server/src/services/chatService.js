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
}
