// Service for sending chat messages to Ollama.
const DEFAULT_MAX_AUTO_CONTINUATIONS = 12;
const DEFAULT_EMPTY_RESPONSE_RETRIES = 2;

export class OllamaService {
  // Store model configuration.
  constructor(config) {
    // Keep host, model, and options for requests.
    this.config = config;
    // Track whether this process has already asked Ollama to load the model.
    this.warmed = false;
    this.warmPromise = null;
  }

  // Generate one non-streaming assistant turn that may contain native tool calls.
  async generateToolTurn(messages, { tools = [] } = {}) {
    await this.#waitForBackgroundWarmUp();

    const options = createRequestOptions(this.config.options, messages);
    const result = await sendChatRequestWithEmptyRetry({
      host: this.config.host,
      model: this.config.model,
      keepAlive: this.config.keepAlive,
      messages: createRequestMessages(messages),
      options,
      tools,
      allowToolCalls: true,
    }, { maxEmptyRetries: this.config.maxEmptyResponseRetries });

    return result.message;
  }

  // Ask Ollama to load the model before the first user message.
  async warmUp() {
    if (this.warmed) {
      return;
    }

    if (this.warmPromise) {
      return this.warmPromise;
    }

    this.warmPromise = this.#loadModel();

    try {
      await this.warmPromise;
      this.warmed = true;
    } finally {
      this.warmPromise = null;
    }
  }

  async #loadModel() {
    const response = await fetch(`${this.config.host}/api/generate`, {
      method: 'POST',
      headers: createOllamaFetchHeaders(this.config.host),
      body: JSON.stringify({
        model: this.config.model,
        prompt: '',
        stream: true,
        keep_alive: this.config.warmKeepAlive ?? '30s',
        options: createWarmUpOptions(this.config.options ?? {}),
      }),
    }).catch((error) => {
      throw new Error(`Could not warm Ollama at ${this.config.host}: ${error.message}`);
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama warm-up failed (${response.status}): ${body}`);
    }

    await drainResponse(response);
  }

  async #waitForBackgroundWarmUp() {
    if (!this.warmPromise) {
      return;
    }

    try {
      await this.warmPromise;
    } catch {
      // The real prompt should get its own chance to report the current Ollama state.
    }
  }

  // Generate an assistant reply from chat history.
  async generateReply(messages, { onToken = null, generationOptions = {}, maxContinuations = null } = {}) {
    const localReply = createLocalFastReply(messages);

    if (localReply) {
      if (typeof onToken === 'function') {
        onToken(localReply);
      }

      return localReply;
    }

    await this.#waitForBackgroundWarmUp();

    const options = {
      ...createRequestOptions(this.config.options, messages),
      ...generationOptions,
    };
    let requestMessages = createRequestMessages(messages);
    let reply = '';
    const continuationLimit = Number(maxContinuations
      ?? this.config.maxAutoContinuations
      ?? DEFAULT_MAX_AUTO_CONTINUATIONS);

    for (let attempt = 0; attempt <= continuationLimit; attempt++) {
      const result = await sendChatRequestWithEmptyRetry({
        host: this.config.host,
        model: this.config.model,
        keepAlive: this.config.keepAlive,
        messages: requestMessages,
        options,
        onToken,
      }, { maxEmptyRetries: this.config.maxEmptyResponseRetries });

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

async function sendChatRequestWithEmptyRetry(params, { maxEmptyRetries = DEFAULT_EMPTY_RESPONSE_RETRIES } = {}) {
  let messages = params.messages;
  const retries = Math.max(0, Number(maxEmptyRetries ?? DEFAULT_EMPTY_RESPONSE_RETRIES));

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await sendChatRequest({
        ...params,
        messages,
      });
    } catch (error) {
      const retry = error?.transient === true
        && error?.code === 'OLLAMA_EMPTY_RESPONSE'
        && attempt < retries;

      if (!retry) {
        throw error;
      }

      messages = createEmptyResponseRetryMessages(messages);
    }
  }

  throw createEmptyResponseError();
}

function createEmptyResponseRetryMessages(messages) {
  return [
    ...messages,
    {
      role: 'user',
      content: 'Your previous response was empty. Respond now with a concrete, non-empty answer. If tools are available and the task requires workspace work, call the correct tool instead of returning empty content.',
    },
  ];
}

// Send one Ollama chat request.
async function sendChatRequest({ host, model, keepAlive, messages, options, onToken, tools = [], allowToolCalls = false }) {
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: createOllamaFetchHeaders(host),
    body: JSON.stringify({
      model,
      messages,
      stream: typeof onToken === 'function',
      keep_alive: keepAlive ?? '2m',
      options,
      ...(tools.length > 0 ? { tools } : {}),
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
  const message = payload.message ?? {};
  const reply = message.content ?? '';
  const toolCalls = message.tool_calls ?? [];

  if (!reply && (!allowToolCalls || toolCalls.length === 0)) {
    throw createEmptyResponseError();
  }

  return {
    reply,
    message: {
      role: 'assistant',
      content: reply,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
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
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.tool_name ? { tool_name: message.tool_name } : {}),
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
    // Only num_predict (output budget) is tuned per prompt. num_ctx is a load-time
    // parameter: changing it forces Ollama to unload and reload the model (minutes),
    // so it stays fixed at the session value to keep the model resident.
    return {
      ...options,
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

// Warm-up must load the model with the SAME num_ctx/num_batch as real requests, or
// Ollama reloads the model on the first real prompt (and again on every prompt while
// a periodic re-warm fights the request context). Only num_predict is shrunk to 1 so
// the warm itself generates nothing; it is not a load-time parameter.
function createWarmUpOptions(options) {
  const stripped = stripJarvisOnlyOptions(options);

  return {
    ...stripped,
    num_predict: 1,
  };
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
  return /\b(code|program|leetcode|solve|java|python|javascript|typescript|html|css|js|c\+\+|algorithm|function|class|n queens?|n-queens?)\b/i.test(content);
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
    throw createEmptyResponseError();
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

// Let the coding scheduler retry occasional blank generations from a loaded model.
function createEmptyResponseError() {
  const error = new Error('Ollama returned an empty response after retrying.');
  error.transient = true;
  error.code = 'OLLAMA_EMPTY_RESPONSE';
  return error;
}


function createOllamaFetchHeaders(host) {
  return {
    'content-type': 'application/json',
    // localtunnel (loca.lt) serves an interstitial reminder page unless this header
    // is present; harmless for the other tunnel providers.
    ...(isPublicTunnelHost(host) ? { 'bypass-tunnel-reminder': 'true' } : {}),
  };
}

function isPublicTunnelHost(host) {
  try {
    const { hostname } = new URL(host);
    return hostname.endsWith('.trycloudflare.com')
      || hostname.endsWith('.loca.lt')
      || hostname.endsWith('.ngrok-free.app');
  } catch {
    return false;
  }
}