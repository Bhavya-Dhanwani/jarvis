// Service for sending chat messages to Ollama.
const DEFAULT_MAX_AUTO_CONTINUATIONS = 12;
const DEFAULT_EMPTY_RESPONSE_RETRIES = 2;
// Transient connection failures (Ollama briefly busy, reloading, or recovering from a
// memory spike during a long coding run) should not abort the whole request.
const DEFAULT_CONNECT_RETRIES = 3;

// fetch() to Ollama with retries on network-level failures ("fetch failed",
// ECONNRESET, ECONNREFUSED). HTTP error responses are returned as-is, not retried.
async function fetchOllama(url, init, { host, retries = DEFAULT_CONNECT_RETRIES } = {}) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;

      if (attempt < retries - 1) {
        await delay(400 * (attempt + 1));
      }
    }
  }

  throw new Error(`Could not reach Ollama at ${host}: ${lastError?.message ?? 'fetch failed'}`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
    const requestMessages = createRequestMessages(messages);

    // Implementation tool turns should not burn time reasoning. Thinking-capable models
    // reason by default, so disable it explicitly (think:false); omit the field only when
    // the model rejects it, mirroring the chat path's fallback.
    const send = (think) => sendChatRequestWithEmptyRetry({
      host: this.config.host,
      model: this.config.model,
      keepAlive: this.config.keepAlive,
      messages: requestMessages,
      options,
      tools,
      allowToolCalls: true,
      think,
    }, { maxEmptyRetries: this.config.maxEmptyResponseRetries });

    try {
      const result = await send(this.thinkDisabled ? undefined : false);
      return result.message;
    } catch (error) {
      if (!this.thinkDisabled && isThinkingUnsupported(error)) {
        this.thinkDisabled = true;
        const result = await send(undefined);
        return result.message;
      }

      throw error;
    }
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
  async generateReply(messages, { onToken = null, onThinking = null, generationOptions = {}, maxContinuations = null, think = null } = {}) {
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

    // Decide whether to stream reasoning this turn: an explicit override wins (the
    // coding agent passes false); otherwise reasoning is enabled in config AND only
    // for complex prompts, so short/casual messages skip the ~10s reasoning step.
    let wantThink = this.#shouldThink(think, latestUserContent(messages));

    for (let attempt = 0; attempt <= continuationLimit; attempt++) {
      let result;

      // Thinking-capable models (e.g. Qwen3) reason by default unless thinking is
      // explicitly turned off, so send think:false rather than omitting the field.
      // Models that reject the field entirely fall back to omitting it (thinkDisabled).
      const thinkParam = this.thinkDisabled ? undefined : wantThink;

      try {
        result = await sendChatRequestWithEmptyRetry({
          host: this.config.host,
          model: this.config.model,
          keepAlive: this.config.keepAlive,
          messages: requestMessages,
          options,
          onToken,
          onThinking,
          think: thinkParam,
        }, { maxEmptyRetries: this.config.maxEmptyResponseRetries });
      } catch (error) {
        // If the model rejects the think flag, stop sending it for this process and
        // retry so chat keeps working on models without a reasoning/thinking mode.
        if (!this.thinkDisabled && isThinkingUnsupported(error)) {
          this.thinkDisabled = true;
          attempt -= 1;
          continue;
        }

        throw error;
      }

      reply += result.reply;

      if (!result.stoppedByLength) {
        return reply.trim();
      }

      // Reasoning that consumes the whole token budget before any answer leaves an
      // empty turn. Re-prompting with "continue where you stopped" then makes thinking
      // models ramble about that instruction instead of answering, so disable thinking
      // and retry the original prompt so the budget goes to the answer.
      if (wantThink && !reply.trim()) {
        wantThink = false;
        continue;
      }

      requestMessages = createContinuationMessages(requestMessages, reply);

      if (typeof onToken === 'function') {
        onToken('\n');
      }
    }

    return reply.trim();
  }

  // Whether to ask Ollama to stream the model's reasoning for this turn. An explicit
  // override wins; otherwise reasoning is on only when enabled in config AND the prompt
  // is complex enough to benefit. Auto-disabled if the model has no thinking mode.
  #shouldThink(override, content) {
    if (this.thinkDisabled === true) {
      return false;
    }

    if (override !== null && override !== undefined) {
      return Boolean(override);
    }

    return (this.config.think ?? true) && isComplexPrompt(content);
  }
}

// Get the most recent user message text from a history array.
function latestUserContent(messages) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

// A prompt is "complex" enough to warrant visible reasoning when it is not a trivial
// greeting and is either a longer message or a coding-style request.
function isComplexPrompt(content) {
  const text = String(content ?? '').trim();

  if (!text || isSimplePrompt(text)) {
    return false;
  }

  if (isCodingPrompt(text)) {
    return true;
  }

  return text.split(/\s+/).length >= 8;
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
async function sendChatRequest({ host, model, keepAlive, messages, options, onToken, onThinking, think = undefined, tools = [], allowToolCalls = false }) {
  const response = await fetchOllama(`${host}/api/chat`, {
    method: 'POST',
    headers: createOllamaFetchHeaders(host),
    body: JSON.stringify({
      model,
      messages,
      stream: typeof onToken === 'function',
      keep_alive: keepAlive ?? '2m',
      options,
      // Thinking-capable models reason by default; pass an explicit boolean so think:false
      // actively disables reasoning. Omit the field only when the model can't accept it.
      ...(think === true ? { think: true } : think === false ? { think: false } : {}),
      ...(tools.length > 0 ? { tools } : {}),
    }),
  }, { host });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  if (typeof onToken === 'function') {
    return readStreamingReply(response, onToken, onThinking);
  }

  const payload = await response.json();
  const message = payload.message ?? {};
  const reply = stripThinkTags(message.content ?? '');
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

// Greeting/address/"how are you" filler words. A message made up entirely of these is
// pure small talk, so it never needs the model (and must never trigger reasoning).
const GREETING_WORDS = /\b(hi+|hey+|heyy+|hello+|yo+|sup|wsup|hiya|heya|howdy|gm|ge|good\s+(morning|evening|afternoon|day))\b/g;
const ADDRESS_WORDS = /\b(bro|man|dude|buddy|mate|pal|sir|maam|jarvis|there|friend|fam|boss)\b/g;
const HOWAREYOU_WORDS = /\b(how('?s| is| are| ya| have\s+you\s+been)?|what'?s\s+(up|good|new)|are|you|u|ya|it|is|going|things|doing|day|today|been|life|lately|all)\b/g;

// Detect messages that are nothing but a casual greeting or "how are you", so they get an
// instant friendly reply instead of waking the model. Shared by the intent router.
export function isSmallTalk(content) {
  const text = String(content ?? '').trim().toLowerCase();

  if (!text || text.length > 60) {
    return false;
  }

  if (/^(thanks|thank you|thx|ty|cheers)\b[\s!.?]*$/.test(text)) {
    return true;
  }

  if (/^(ok|okay|k|kk|nice|cool|great|got it|gotcha|np|nvm|lol|haha)\b[\s!.?]*$/.test(text)) {
    return true;
  }

  // Remove all greeting/address/"how are you" filler. If nothing meaningful is left and
  // the message actually contained a greeting, it is pure small talk.
  const stripped = text
    .replace(GREETING_WORDS, ' ')
    .replace(ADDRESS_WORDS, ' ')
    .replace(HOWAREYOU_WORDS, ' ')
    .replace(/[^a-z]+/g, '');
  const hasGreeting = /\b(hi+|hey+|hello+|yo+|sup|hiya|heya|howdy|how|what'?s\s+(up|good|new))\b/.test(text);

  return stripped.length === 0 && hasGreeting;
}

// Answer tiny social turns locally so the first prompt does not need to load the model.
function createLocalFastReply(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const content = latestUserMessage?.content?.trim().toLowerCase() ?? '';

  if (!isSmallTalk(content)) {
    return null;
  }

  if (/^(thanks|thank you|thx|ty|cheers)\b/.test(content)) {
    return 'You are welcome!';
  }

  if (/^(ok|okay|k|kk|nice|cool|great|got it|gotcha|np|nvm|lol|haha)\b/.test(content)) {
    return 'Got it.';
  }

  if (/\bhow\b|\bsup\b|\bwhat'?s\s+(up|good|new)\b/.test(content)) {
    return "Hey! I'm doing great, thanks for asking. What can I help you with?";
  }

  return 'Hi! How can I help?';
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

// Some models stream chain-of-thought inline as <think>...</think> inside the answer
// content instead of Ollama's separate `thinking` field. Route that reasoning to the
// thinking channel (dimmed + collapsed by the UI) so it never pollutes the real answer.
// The router buffers across chunks so a tag split between reads is still detected.
function createThinkTagRouter({ onAnswer, onThink }) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inside = false;
  let pending = '';

  // Length of the trailing run of `text` that is a prefix of `tag` (a possible split tag).
  const heldPrefix = (text, tag) => {
    const max = Math.min(text.length, tag.length - 1);

    for (let size = max; size > 0; size -= 1) {
      if (text.slice(text.length - size) === tag.slice(0, size)) {
        return size;
      }
    }

    return 0;
  };

  const push = (text) => {
    pending += text;

    while (pending) {
      const tag = inside ? CLOSE : OPEN;
      const index = pending.indexOf(tag);

      if (index !== -1) {
        const before = pending.slice(0, index);
        if (before) (inside ? onThink : onAnswer)(before);
        pending = pending.slice(index + tag.length);
        inside = !inside;
        continue;
      }

      const hold = heldPrefix(pending, tag);
      const ready = pending.slice(0, pending.length - hold);
      if (ready) (inside ? onThink : onAnswer)(ready);
      pending = pending.slice(pending.length - hold);
      break;
    }
  };

  const flush = () => {
    if (pending) (inside ? onThink : onAnswer)(pending);
    pending = '';
  };

  return { push, flush };
}

// Remove inline <think>...</think> reasoning from a non-streamed answer.
function stripThinkTags(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

// Read Ollama's newline-delimited streaming response.
async function readStreamingReply(response, onToken, onThinking = null) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let reply = '';
  let stoppedByLength = false;

  const router = createThinkTagRouter({
    onAnswer: (text) => {
      reply += text;
      onToken(text);
    },
    onThink: (text) => {
      if (typeof onThinking === 'function') {
        onThinking(text);
      }
    },
  });

  const emit = (parsed) => {
    stoppedByLength = stoppedByLength || parsed.stoppedByLength;

    if (parsed.thinking && typeof onThinking === 'function') {
      onThinking(parsed.thinking);
    }

    if (parsed.content) {
      router.push(parsed.content);
    }
  };

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      emit(parseStreamLine(line, { hasReply: reply.length > 0 }));
    }
  }

  emit(parseStreamLine(buffer, { hasReply: reply.length > 0 }));
  router.flush();

  // Empty output is only a (retryable) failure when the model actually stopped. If it
  // hit the length limit, return so generateReply can continue from where it stopped.
  if (!reply.trim() && !stoppedByLength) {
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
    return { content: '', thinking: '', stoppedByLength: false };
  }

  const payload = JSON.parse(trimmed);

  if (payload.error) {
    throw new Error(payload.error);
  }

  return {
    content: payload.message?.content ?? '',
    // Thinking-capable models stream their reasoning in a separate `thinking` field.
    thinking: payload.message?.thinking ?? '',
    // Hitting the token limit is not an error: generateReply auto-continues from here
    // (e.g. when reasoning consumed the budget before the answer started).
    stoppedByLength: payload.done_reason === 'length',
  };
}

// Detect an Ollama error that means the model has no thinking/reasoning mode.
function isThinkingUnsupported(error) {
  return /think/i.test(error?.message ?? '');
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