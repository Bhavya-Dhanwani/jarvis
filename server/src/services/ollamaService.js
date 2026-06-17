export class OllamaService {
  constructor(config) {
    this.config = config;
  }

  async generateReply(messages) {
    const response = await fetch(`${this.config.host}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: 'You are Jarvis, a concise local AI assistant. Be useful, direct, and clear.',
          },
          ...messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        stream: false,
        options: this.config.options,
      }),
    }).catch((error) => {
      throw new Error(`Could not reach Ollama at ${this.config.host}: ${error.message}`);
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return payload.message?.content?.trim() ?? '';
  }
}
