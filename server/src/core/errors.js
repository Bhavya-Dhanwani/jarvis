export class NoChatSessionError extends Error {
  constructor(message = 'No chat sessions found. Run "jarvis" to start a new chat.') {
    super(message);
    this.name = 'NoChatSessionError';
  }
}
