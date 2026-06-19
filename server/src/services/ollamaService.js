// Service for sending chat messages to Ollama.
const DEFAULT_MAX_AUTO_CONTINUATIONS = 12;

export class OllamaService {
  // Store model configuration.
  constructor(config) {
    // Keep host, model, and options for requests.
    this.config = config;
    // Track whether this process has already asked Ollama to load the model.
    this.warmed = false;
  }

  // Ask Ollama to load the model before the first user message.
  async warmUp() {
    if (this.warmed) {
      return;
    }

    const response = await fetch(`${this.config.host}/api/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt: '',
        stream: true,
        keep_alive: this.config.keepAlive ?? '2m',
        options: {
          ...stripJarvisOnlyOptions(this.config.options ?? {}),
          num_predict: 1,
        },
      }),
    }).catch((error) => {
      throw new Error(`Could not warm Ollama at ${this.config.host}: ${error.message}`);
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama warm-up failed (${response.status}): ${body}`);
    }

    await drainResponse(response);
    this.warmed = true;
  }

  // Generate an assistant reply from chat history.
  async generateReply(messages, { onToken = null } = {}) {
    const localReply = createLocalFastReply(messages);

    if (localReply) {
      if (typeof onToken === 'function') {
        onToken(localReply);
      }

      return localReply;
    }

    const options = createRequestOptions(this.config.options, messages);
    let requestMessages = createRequestMessages(messages);
    let reply = '';
    const maxContinuations = Number(this.config.maxAutoContinuations ?? DEFAULT_MAX_AUTO_CONTINUATIONS);

    for (let attempt = 0; attempt <= maxContinuations; attempt++) {
      const result = await sendChatRequest({
        host: this.config.host,
        model: this.config.model,
        keepAlive: this.config.keepAlive,
        messages: requestMessages,
        options,
        onToken,
      });

      reply += result.reply;

      if (!result.stoppedByLength) {
        return reply.trim();
      }

      requestMessages = createContinuationMessages(requestMessages, reply);

      if (typeof onToken === 'function') {
        onToken('\n');
      }
    }

    return reply.trim();
  }
}

// Send one Ollama chat request.
async function sendChatRequest({ host, model, keepAlive, messages, options, onToken }) {
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: typeof onToken === 'function',
      keep_alive: keepAlive ?? '2m',
      options,
    }),
  }).catch((error) => {
    throw new Error(`Could not reach Ollama at ${host}: ${error.message}`);
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  if (typeof onToken === 'function') {
    return readStreamingReply(response, onToken);
  }

  const payload = await response.json();
  const reply = payload.message?.content ?? '';

  if (!reply) {
    throw new Error('Ollama returned an empty response.');
  }

  return {
    reply,
    stoppedByLength: payload.done_reason === 'length',
  };
}

// Build Ollama chat messages from persisted history.
function createRequestMessages(messages) {
  return [
    {
      role: 'system',
      content: 'You are Jarvis, a fast local AI assistant. For greetings or simple messages, answer in one short line. For coding requests, provide one compact complete solution first. Do not include long explanations unless the user asks for them. For normal questions, be concise and direct unless the user asks for detail.',
    },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

// Ask Ollama to continue without repeating text already streamed.
function createContinuationMessages(messages, partialReply) {
  return [
    ...messages,
    {
      role: 'assistant',
      content: partialReply,
    },
    {
      role: 'user',
      content: 'Continue exactly where you stopped. Do not repeat any earlier text. Finish the answer completely.',
    },
  ];
}

// Adjust generation budget to the request instead of using one tiny cap for all prompts.
export function createRequestOptions(baseOptions = {}, messages = []) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const content = latestUserMessage?.content?.toLowerCase() ?? '';
  const options = stripJarvisOnlyOptions(baseOptions);

  if (isSimplePrompt(content)) {
    return {
      ...options,
      num_predict: Math.min(Number(options.num_predict ?? 64), 64),
    };
  }

  if (isCodingPrompt(content)) {
    return {
      ...options,
      num_ctx: Math.max(Number(baseOptions.code_num_ctx ?? options.num_ctx ?? 2048), 2048),
      num_predict: Number(baseOptions.code_num_predict ?? 384),
    };
  }

  return {
    ...options,
    num_predict: Math.max(Number(options.num_predict ?? 64), 256),
  };
}

// Keep app tuning keys out of the Ollama options payload.
function stripJarvisOnlyOptions(options) {
  const {
    code_num_ctx: _codeNumCtx,
    code_num_predict: _codeNumPredict,
    ...ollamaOptions
  } = options;

  return ollamaOptions;
}

// Detect prompts that should stay extremely short.
function isSimplePrompt(content) {
  return /^(hi|hii|hello|hey|yo|thanks|thank you|ok|okay|nice|cool)[\s!.?]*$/i.test(content.trim());
}

// Answer tiny social turns locally so the first prompt does not need to load the model.
function createLocalFastReply(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const content = latestUserMessage?.content?.trim().toLowerCase() ?? '';

  if (/^(hi|hii|hello|hey|yo)[\s!.?]*$/.test(content)) {
    return 'Hi! How can I help?';
  }

  if (/^(thanks|thank you)[\s!.?]*$/.test(content)) {
    return 'You are welcome.';
  }

  if (/^(ok|okay|nice|cool)[\s!.?]*$/.test(content)) {
    return 'Got it.';
  }

  return null;
}

// Detect prompts where a tiny output cap can cause blank or unusable answers.
function isCodingPrompt(content) {
  return /\b(code|program|leetcode|solve|java|python|javascript|c\+\+|algorithm|function|class|n queens?|n-queens?)\b/i.test(content);
}

// Consume a streaming warm-up response without rendering it.
async function drainResponse(response) {
  const reader = response.body?.getReader?.();

  if (!reader) {
    await response.text();
    return;
  }

  while (true) {
    const { done } = await reader.read();

    if (done) {
      return;
    }
  }
}

// Read Ollama's newline-delimited streaming response.
async function readStreamingReply(response, onToken) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let reply = '';
  let stoppedByLength = false;

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseStreamLine(line, { hasReply: reply.length > 0 });
      const chunk = parsed.content;

      if (!chunk) {
        stoppedByLength = stoppedByLength || parsed.stoppedByLength;
        continue;
      }

      reply += chunk;
      onToken(chunk);
      stoppedByLength = stoppedByLength || parsed.stoppedByLength;
    }
  }

  const parsedTail = parseStreamLine(buffer, { hasReply: reply.length > 0 });
  const tail = parsedTail.content;
  stoppedByLength = stoppedByLength || parsedTail.stoppedByLength;

  if (tail) {
    reply += tail;
    onToken(tail);
  }

  if (!reply.trim()) {
    throw new Error('Ollama returned an empty response.');
  }

  return {
    reply,
    stoppedByLength,
  };
}

// Parse one Ollama streaming JSON line.
function parseStreamLine(line, { hasReply = false } = {}) {
  const trimmed = line.trim();

  if (!trimmed) {
    return { content: '', stoppedByLength: false };
  }

  const payload = JSON.parse(trimmed);

  if (payload.error) {
    throw new Error(payload.error);
  }

  if (payload.done && payload.done_reason === 'length' && !hasReply) {
    throw new Error('Ollama stopped before producing text. Increase the response token budget.');
  }

  return {
    content: payload.message?.content ?? '',
    stoppedByLength: payload.done_reason === 'length',
  };
}
