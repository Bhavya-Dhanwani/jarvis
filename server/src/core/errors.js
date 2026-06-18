// Define the error used when no saved chat exists.
export class NoChatSessionError extends Error {
  // Create the error with a friendly default message.
  constructor(message = 'No chat sessions found. Run "jarvis" to start a new chat.') {
    // Pass the message to the base Error class.
    super(message);
    // Set a stable error name for instanceof-style handling and logs.
    this.name = 'NoChatSessionError';
  }
}
