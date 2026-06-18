// Service for sending chat messages to Ollama.
export class OllamaService {
  // Store model configuration.
  constructor(config) {
    // Keep host, model, and options for requests.
    this.config = config;
  }

  // Generate an assistant reply from chat history.
  async generateReply(messages) {
    // Send a non-streaming chat request to Ollama.
    const response = await fetch(`${this.config.host}/api/chat`, {
      // Use POST for chat generation.
      method: 'POST',
      // Send JSON headers.
      headers: {
        // Tell Ollama the body is JSON.
        'content-type': 'application/json',
      },
      // Build the Ollama chat request body.
      body: JSON.stringify({
        // Use the configured model.
        model: this.config.model,
        // Send a system prompt plus stored messages.
        messages: [
          // Add the JARVIS system instruction.
          {
            // Mark this as a system message.
            role: 'system',
            // Define assistant behavior.
            content: 'You are Jarvis, a concise local AI assistant. Be useful, direct, and clear.',
          },
          // Convert persisted messages to Ollama's message shape.
          ...messages.map((message) => ({
            // Preserve the message role.
            role: message.role,
            // Preserve the message content.
            content: message.content,
          })),
        ],
        // Ask Ollama for a complete response instead of streaming chunks.
        stream: false,
        // Pass configured model options.
        options: this.config.options,
      }),
    // Convert network failures into helpful errors.
    }).catch((error) => {
      // Include the configured host in the error.
      throw new Error(`Could not reach Ollama at ${this.config.host}: ${error.message}`);
    });

    // Handle non-2xx Ollama responses.
    if (!response.ok) {
      // Read the response body for diagnostics.
      const body = await response.text();
      // Throw a detailed request failure.
      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    // Parse the JSON response.
    const payload = await response.json();
    // Return the assistant content or an empty string.
    return payload.message?.content?.trim() ?? '';
  }
}
